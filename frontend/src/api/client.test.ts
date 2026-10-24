import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch, ApiError, NO_READINGS_YET } from "./client";
import { getLatestReading } from "./endpoints";

type FetchImpl = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

function mockFetch(impl: FetchImpl) {
  const spy = vi.fn<FetchImpl>(impl);
  vi.stubGlobal("fetch", spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("apiFetch", () => {
  it("parses a JSON body on success", async () => {
    mockFetch(async () => new Response(JSON.stringify({ a: 1 }), { status: 200 }));
    await expect(apiFetch("/x")).resolves.toEqual({ a: 1 });
  });

  it("resolves to undefined on 204", async () => {
    mockFetch(async () => new Response(null, { status: 204 }));
    await expect(apiFetch("/x")).resolves.toBeUndefined();
  });

  it("throws ApiError with detail from the backend body", async () => {
    mockFetch(
      async () =>
        new Response(JSON.stringify({ detail: "capacity exceeded" }), {
          status: 409,
        }),
    );
    await expect(apiFetch("/x")).rejects.toMatchObject({
      status: 409,
      detail: "capacity exceeded",
    });
  });

  it("flattens pydantic validation detail arrays", async () => {
    mockFetch(
      async () =>
        new Response(
          JSON.stringify({ detail: [{ msg: "bad" }, { msg: "worse" }] }),
          { status: 422 },
        ),
    );
    const err = await apiFetch("/x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).detail).toBe("bad; worse");
  });

  it("normalizes network failure to ApiError status 0", async () => {
    mockFetch(async () => {
      throw new TypeError("network down");
    });
    await expect(apiFetch("/x")).rejects.toMatchObject({ status: 0 });
  });

  it("serializes a JSON body and sets content-type for writes", async () => {
    const spy = mockFetch(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    await apiFetch("/x", { method: "POST", body: { enabled: true } });
    const init = spy.mock.calls[0]?.[1];
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ enabled: true }));
    expect((init?.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );
  });
});

describe("getLatestReading", () => {
  it("returns the NO_READINGS_YET sentinel on 404", async () => {
    mockFetch(
      async () =>
        new Response(JSON.stringify({ detail: "none" }), { status: 404 }),
    );
    await expect(getLatestReading(1)).resolves.toBe(NO_READINGS_YET);
  });

  it("rethrows non-404 errors", async () => {
    mockFetch(
      async () =>
        new Response(JSON.stringify({ detail: "boom" }), { status: 500 }),
    );
    await expect(getLatestReading(1)).rejects.toMatchObject({ status: 500 });
  });
});

describe("timestamp normalization (backend sends naive UTC)", () => {
  it("treats a naive timestamp as UTC and trims microseconds", async () => {
    const { normalizeUtcTimestamp } = await import("./endpoints");
    const n = normalizeUtcTimestamp("2026-10-24T20:34:26.819569");
    expect(n).toBe("2026-10-24T20:34:26.819Z");
    expect(Date.parse(n)).toBe(Date.UTC(2026, 9, 24, 20, 34, 26, 819));
  });

  it("leaves explicit offsets untouched", async () => {
    const { normalizeUtcTimestamp } = await import("./endpoints");
    expect(normalizeUtcTimestamp("2026-10-24T20:34:26Z")).toBe("2026-10-24T20:34:26Z");
    expect(normalizeUtcTimestamp("2026-10-24T16:34:26.5+04:00")).toBe("2026-10-24T16:34:26.5+04:00");
  });

  it("normalizes the latest reading and rejects malformed payloads", async () => {
    const { getLatestReading } = await import("./endpoints");
    mockFetch(
      async () =>
        new Response(
          JSON.stringify({ id: 1, equipment_id: 1, temperature: -80.4, timestamp: "2026-10-24T20:34:26.819569" }),
          { status: 200 },
        ),
    );
    await expect(getLatestReading(1)).resolves.toMatchObject({ timestamp: "2026-10-24T20:34:26.819Z" });

    mockFetch(
      async () =>
        new Response(JSON.stringify({ id: 1, equipment_id: 1, temperature: "hot", timestamp: "x" }), { status: 200 }),
    );
    await expect(getLatestReading(1)).rejects.toMatchObject({ status: 502 });
  });

  it("drops malformed history rows instead of plotting them", async () => {
    const { getReadingHistory } = await import("./endpoints");
    mockFetch(
      async () =>
        new Response(
          JSON.stringify([
            { id: 2, equipment_id: 1, temperature: -79, timestamp: "2026-10-24T20:34:29.1" },
            { id: 1, equipment_id: 1, temperature: null, timestamp: "2026-10-24T20:34:26.1" },
          ]),
          { status: 200 },
        ),
    );
    const rows = await getReadingHistory(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.timestamp.endsWith("Z")).toBe(true);
  });
});
