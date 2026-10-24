/**
 * Live-backend integration check, fully isolated.
 *
 * Starts its own FastAPI backend on a dedicated port with a brand-new,
 * disposable SQLite database (via DATABASE_URL), runs the demo workflow
 * through the real HTTP API, then stops that backend and deletes the
 * database. It never connects to, reads, or modifies a working database.
 *
 * Usage (from the repository root):  node scripts/verify-e2e.mjs
 * Requires Python with backend/requirements.txt installed.
 * Optional env: VERIFY_PORT (default 8079), PYTHON (default "python").
 */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.join(here, "..", "backend");
const PORT = Number(process.env.VERIFY_PORT ?? 8079);
const BASE = `http://127.0.0.1:${PORT}`;

let pass = 0;
let fail = 0;
function check(name, ok, extra = "") {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(p, method = "GET", body) {
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: body != null ? { "Content-Type": "application/json" } : undefined,
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : undefined };
}

async function healthy() {
  try {
    return (await fetch(`${BASE}/api/health`)).ok;
  } catch {
    return false;
  }
}

function covers(dest, s) {
  return dest.min_temperature <= s.min_temperature && dest.max_temperature >= s.max_temperature;
}

/** Backend timestamps are naive UTC (SQLite drops tzinfo). */
function parseUtc(ts) {
  return Date.parse(/(?:z|[+-]\d{2}:?\d{2})$/i.test(ts) ? ts : `${ts}Z`);
}

async function workflow() {
  check("health endpoint ok", await healthy());

  const empty = await api("/api/equipment");
  check("disposable database starts empty", empty.status === 200 && empty.data.length === 0);

  const units = [];
  for (const e of [
    { name: "ULF A", type: "ultra-low", location: "Verify", min_temperature: -86, max_temperature: -70, storage_capacity: 40, sample_limit: 20 },
    { name: "ULF B", type: "ultra-low", location: "Verify", min_temperature: -86, max_temperature: -65, storage_capacity: 60, sample_limit: 30 },
    { name: "Fridge", type: "fridge", location: "Verify", min_temperature: 2, max_temperature: 8, storage_capacity: 50, sample_limit: null },
  ]) {
    units.push((await api("/api/equipment", "POST", { ...e, status: "operational" })).data);
  }
  const [ulfA, , fridge] = units;
  check("created 3 equipment with derived capacity", units.every((u) => u?.id) && ulfA.available_storage === 40 && ulfA.available_slots === 20);

  for (const s of [
    { name: "Plasma", min_temperature: -86, max_temperature: -70, storage_space: 8, priority: "critical" },
    { name: "CellLine", min_temperature: -80, max_temperature: -70, storage_space: 6, priority: "high" },
    { name: "RNA", min_temperature: -80, max_temperature: -72, storage_space: 4, priority: "medium" },
  ]) {
    await api("/api/samples", "POST", { ...s, equipment_id: ulfA.id });
  }
  check("created 3 samples", (await api(`/api/samples?equipment_id=${ulfA.id}`)).data.length === 3);

  const badTemp = await api("/api/samples", "POST", { name: "x", equipment_id: fridge.id, min_temperature: -80, max_temperature: -70, storage_space: 1, priority: "low" });
  check("backend rejects temperature-incompatible placement (422)", badTemp.status === 422, `status ${badTemp.status}`);
  const overCap = await api("/api/samples", "POST", { name: "y", equipment_id: ulfA.id, min_temperature: -80, max_temperature: -75, storage_space: 999, priority: "low" });
  check("backend rejects over-capacity placement (409)", overCap.status === 409, `status ${overCap.status}`);

  const start = await api("/api/simulation/start", "POST", { interval_seconds: 1 });
  check("simulation started", start.status === 200 && start.data.running === true);
  await sleep(2500);
  const latest = await api(`/api/simulation/equipment/${ulfA.id}/latest`);
  check("latest reading available", latest.status === 200 && typeof latest.data.temperature === "number");
  const ts = latest.data?.timestamp ?? "";
  const skew = Math.abs(parseUtc(ts) - Date.now());
  check("timestamp is UTC when read as naive (frontend normalization)", skew < 60_000, `"${ts}", skew ${Math.round(skew / 1000)} s`);
  const hist = (await api(`/api/simulation/equipment/${ulfA.id}/history?limit=10`)).data;
  const desc = hist.every((r, i) => i === 0 || parseUtc(hist[i - 1].timestamp) >= parseUtc(r.timestamp));
  check("history returned newest first", hist.length > 1 && desc, `${hist.length} readings`);

  const failOn = await api(`/api/simulation/equipment/${ulfA.id}/fail`, "POST", { enabled: true });
  check("failure injected", failOn.data?.failed_equipment_ids?.includes(ulfA.id));
  await sleep(2000);
  check("failed unit marked offline", (await api(`/api/equipment/${ulfA.id}`)).data.status === "offline");
  const failedTemp = (await api(`/api/simulation/equipment/${ulfA.id}/latest`)).data.temperature;
  check("failed unit emits out-of-range reading", failedTemp > ulfA.max_temperature || failedTemp < ulfA.min_temperature, `${failedTemp} °C`);

  // Same placement rule and priority order as frontend/src/domain/rescue.ts.
  const equipment = (await api("/api/equipment")).data;
  const candidates = equipment.filter((e) => e.id !== ulfA.id && e.status !== "offline");
  const free = new Map(candidates.map((c) => [c.id, { storage: Math.max(0, c.available_storage), slots: c.available_slots == null ? null : Math.max(0, c.available_slots) }]));
  const rank = { critical: 4, high: 3, medium: 2, low: 1 };
  const source = (await api(`/api/samples?equipment_id=${ulfA.id}`)).data;
  const ordered = [...source].sort((a, b) => (rank[b.priority] ?? 0) - (rank[a.priority] ?? 0) || b.storage_space - a.storage_space || a.id - b.id);
  const moves = [];
  for (const s of ordered) {
    const options = candidates
      .filter((c) => covers(c, s) && free.get(c.id).storage >= s.storage_space && (free.get(c.id).slots == null || free.get(c.id).slots >= 1))
      .sort((a, b) => {
        const slack = (d) => s.min_temperature - d.min_temperature + (d.max_temperature - s.max_temperature);
        return slack(a) - slack(b) || free.get(b.id).storage - free.get(a.id).storage;
      });
    const dest = options[0];
    if (!dest) continue;
    free.get(dest.id).storage -= s.storage_space;
    if (free.get(dest.id).slots != null) free.get(dest.id).slots -= 1;
    moves.push({ s, dest });
  }
  check("rescue plan places all samples", moves.length === source.length, `${moves.length}/${source.length}`);
  let moved = 0;
  for (const { s, dest } of moves) {
    if ((await api(`/api/samples/${s.id}`, "PATCH", { equipment_id: dest.id })).status === 200) moved += 1;
  }
  check("backend accepts every rescue move", moved === moves.length, `${moved}/${moves.length}`);

  const after = (await api("/api/samples")).data;
  const byId = new Map((await api("/api/equipment")).data.map((e) => [e.id, e]));
  check("no sample left in the failed unit", after.every((s) => s.equipment_id !== ulfA.id));
  check("every sample in compatible, online storage", after.every((s) => byId.get(s.equipment_id)?.status !== "offline" && covers(byId.get(s.equipment_id), s)));

  await api(`/api/simulation/equipment/${ulfA.id}/fail`, "POST", { enabled: false });
  await sleep(1500);
  const stillOffline = (await api(`/api/equipment/${ulfA.id}`)).data.status;
  check("clearing the failure flag leaves status offline (why Reset restores it)", stillOffline === "offline", stillOffline);
  const restored = await api(`/api/equipment/${ulfA.id}`, "PATCH", { status: "operational" });
  check("status can be restored to operational", restored.status === 200 && restored.data.status === "operational");

  const stop = await api("/api/simulation/stop", "POST");
  check("simulation stopped", stop.status === 200 && stop.data.running === false);
}

async function main() {
  if (await healthy()) {
    console.error(`Port ${PORT} already serves a backend. Refusing to run against a server this script did not start.`);
    process.exit(1);
  }
  const tmp = mkdtempSync(path.join(tmpdir(), "labsentinel-verify-"));
  const dbFile = path.join(tmp, "verify.db");
  console.log(`\nLabSentinel integration check — isolated backend ${BASE}`);
  console.log(`Disposable database: ${dbFile}\n`);

  const server = spawn(
    process.env.PYTHON ?? "python",
    ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(PORT)],
    {
      cwd: backendDir,
      env: { ...process.env, DATABASE_URL: `sqlite:///${dbFile.replace(/\\/g, "/")}` },
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  let stderr = "";
  server.stderr.on("data", (d) => (stderr += d.toString()));

  try {
    const deadline = Date.now() + 30_000;
    while (!(await healthy())) {
      if (server.exitCode != null || Date.now() > deadline) {
        throw new Error(`Backend did not start.\n${stderr.slice(-2000)}`);
      }
      await sleep(300);
    }
    if (server.exitCode != null) throw new Error("Backend exited after start; refusing to continue.");
    await workflow();
  } catch (err) {
    fail += 1;
    console.error(`  FAIL  ${err.message}`);
  } finally {
    server.kill();
    await sleep(800);
    try {
      rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    } catch (e) {
      console.log(`  note: could not delete ${tmp}: ${e.message}`);
    }
  }
  console.log(`\nRESULT: ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
