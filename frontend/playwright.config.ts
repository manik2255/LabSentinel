import { defineConfig, devices } from "@playwright/test";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Browser E2E configuration.
 *
 * Isolation: every run starts its own backend on a dedicated port with a
 * brand-new, disposable SQLite database (backend reads DATABASE_URL), and its
 * own frontend dev server pointed at that backend. Existing servers are never
 * reused, so tests cannot read or modify a developer's working database.
 * Port 3000 is used for the frontend because it is in the backend's CORS
 * allow-list (the normal dev server keeps 5173).
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = path.join(here, "e2e", ".tmp");
const API_PORT = 8078;
const WEB_PORT = 3000;

let dbPath = process.env.LABSENTINEL_E2E_DB;
if (!dbPath) {
  // First load in the main process: clear old run databases (best effort;
  // a file still locked by a crashed run is left alone) and pick a new one.
  mkdirSync(tmpDir, { recursive: true });
  for (const f of readdirSync(tmpDir)) {
    try {
      rmSync(path.join(tmpDir, f), { force: true });
    } catch {
      // ignore
    }
  }
  dbPath = path.join(tmpDir, `e2e-${Date.now()}.db`);
  process.env.LABSENTINEL_E2E_DB = dbPath;
}
const databaseUrl = `sqlite:///${dbPath.replace(/\\/g, "/")}`;

export const E2E_API_URL = `http://127.0.0.1:${API_PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    headless: true,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: `python -m uvicorn app.main:app --host 127.0.0.1 --port ${API_PORT}`,
      cwd: path.join(here, "..", "backend"),
      url: `${E2E_API_URL}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { DATABASE_URL: databaseUrl },
    },
    {
      command: `npx vite --host 127.0.0.1 --port ${WEB_PORT} --strictPort`,
      cwd: here,
      url: `http://127.0.0.1:${WEB_PORT}/`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { VITE_API_BASE_URL: E2E_API_URL },
    },
  ],
});
