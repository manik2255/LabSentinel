/**
 * Thin typed HTTP client over the verified LabSentinel backend contract.
 *
 * This is the ONLY module that knows about URLs and HTTP. On a non-2xx
 * response it throws a typed {@link ApiError} built from the backend's
 * `{ detail }` body. A 204 resolves to `undefined`.
 */

import { API_BASE_URL } from "../config";

export class ApiError extends Error {
  readonly status: number;
  readonly detail: string;

  constructor(status: number, detail: string) {
    super(detail || `Request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

/**
 * Sentinel returned (not thrown) by monitoring reads when the backend responds
 * 404 "no readings yet", so callers can distinguish "awaiting data" from a real
 * error.
 */
export const NO_READINGS_YET = Symbol("NO_READINGS_YET");
export type NoReadingsYet = typeof NO_READINGS_YET;

async function parseDetail(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { detail?: unknown };
    if (typeof body?.detail === "string") return body.detail;
    if (Array.isArray(body?.detail)) {
      // Pydantic validation errors come back as an array of objects.
      return body.detail
        .map((e) =>
          e && typeof e === "object" && "msg" in e
            ? String((e as { msg: unknown }).msg)
            : JSON.stringify(e),
        )
        .join("; ");
    }
    return JSON.stringify(body);
  } catch {
    return res.statusText;
  }
}

export interface ApiFetchOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
}

export async function apiFetch<T>(
  path: string,
  options: ApiFetchOptions = {},
): Promise<T> {
  const { method = "GET", body, signal } = options;

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: body != null ? { "Content-Type": "application/json" } : undefined,
      body: body != null ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (cause) {
    // Network-level failure (backend down, CORS, DNS). Normalize to ApiError.
    throw new ApiError(0, "Cannot reach the LabSentinel backend.");
  }

  if (res.status === 204) {
    return undefined as T;
  }

  if (!res.ok) {
    throw new ApiError(res.status, await parseDetail(res));
  }

  // Some endpoints may return empty bodies with 200; guard JSON parse.
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
