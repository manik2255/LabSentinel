import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Browser E2E for LabSentinel against the real backend (Isolation Forest risk,
 * MILP rescue plans, persistent incidents). playwright.config.ts starts a
 * dedicated backend with a fresh, disposable SQLite database for every run,
 * so these tests never touch a developer's working data. Tests run in order
 * and share that database.
 */

const API = "http://127.0.0.1:8078";
const LONG = 20_000;

function trackPageErrors(page: Page): Error[] {
  const errors: Error[] = [];
  page.on("pageerror", (err) => errors.push(err));
  return errors;
}

async function seedTeammateRecord(request: APIRequestContext) {
  // A range that cannot hold any demo sample, so the backend optimizer never
  // proposes it as a destination; the test proves it is never modified.
  const unit = await request.post(`${API}/api/equipment`, {
    data: {
      name: "Teammate Freezer",
      type: "Freezer",
      location: "Building 4",
      min_temperature: -60,
      max_temperature: -40,
      storage_capacity: 20,
      sample_limit: null,
      status: "operational",
    },
  });
  expect(unit.ok()).toBe(true);
  const eq = (await unit.json()) as { id: number };
  const sample = await request.post(`${API}/api/samples`, {
    data: {
      name: "Teammate Biopsy",
      equipment_id: eq.id,
      min_temperature: -55,
      max_temperature: -45,
      storage_space: 2,
      priority: "high",
    },
  });
  expect(sample.ok()).toBe(true);
  return eq.id;
}

test("removing demo data needs confirmation and keeps other inventory", async ({ page, request }) => {
  const pageErrors = trackPageErrors(page);
  await page.goto("/");
  await expect(page.getByText("Backend online")).toBeVisible({ timeout: LONG });
  await page.getByRole("button", { name: "Set up demo" }).first().click();
  await expect(page.getByRole("heading", { name: "Ultra-Low Freezer A" })).toBeVisible({ timeout: LONG });

  const before = (await (await request.get(`${API}/api/equipment`)).json()) as Array<{ name: string; location: string }>;
  const otherBefore = before.filter((e) => !e.location.startsWith("Demo Lab - "));

  const remove = page.getByRole("button", { name: "Remove demo data…" });
  await remove.click();
  const dialog = page.getByRole("alertdialog", { name: "Permanently delete demo data?" });
  await expect(dialog).toBeFocused();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(remove).toBeFocused();
  expect(((await (await request.get(`${API}/api/equipment`)).json()) as unknown[]).length).toBe(before.length);

  await remove.click();
  await dialog.getByRole("button", { name: "Delete demo data" }).click();
  await expect(page.getByText(/Deleted 5 demo sample\(s\) and 4 demo unit\(s\)/)).toBeVisible({ timeout: LONG });

  const after = (await (await request.get(`${API}/api/equipment`)).json()) as Array<{ name: string; location: string }>;
  expect(after.filter((e) => e.location.startsWith("Demo Lab - "))).toHaveLength(0);
  expect(after.map((e) => e.name).sort()).toEqual(otherBefore.map((e) => e.name).sort());
  expect(pageErrors.map((e) => e.message)).toEqual([]);

  // Leave the shared test backend clean: stopping clears the simulator's
  // per-equipment state, which SQLite id reuse would otherwise carry over.
  expect((await request.post(`${API}/api/simulation/stop`)).ok()).toBe(true);
});

test("backend-powered incident: ML risk, MILP plan, approval, execution, recovery, closure", async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  const pageErrors = trackPageErrors(page);
  const teammateId = await seedTeammateRecord(request);

  // 1. Healthy lab.
  await page.goto("/");
  await expect(page.getByText("Backend online")).toBeVisible({ timeout: LONG });
  await page.getByRole("button", { name: "Set up demo" }).first().click();
  await expect(page.getByText(/Created 4 demo units and 5 demo samples/)).toBeVisible({ timeout: LONG });
  await expect(page.getByText(/All \d+ unit\(s\) with fresh readings are within/)).toBeVisible({ timeout: LONG });
  await page.screenshot({ path: "e2e/artifacts/01-overview-healthy.png", fullPage: true });

  // 2. Fault injection is disabled outside the demo lab.
  await page.getByRole("link", { name: /Telemetry & controls for Teammate Freezer/ }).click();
  await expect(page.getByText(/Fault injection is limited to demo units/)).toBeVisible({ timeout: LONG });
  await expect(page.getByRole("switch", { name: "Hardware failure" })).toBeDisabled();

  // 3. Backend ML risk on a demo unit, then a simulated hardware failure.
  await page.getByRole("link", { name: "Overview" }).click();
  await page.getByRole("link", { name: /Telemetry & controls for Ultra-Low Freezer A/ }).click();
  await expect(page.getByRole("heading", { name: "ML Risk Assessment" })).toBeVisible({ timeout: LONG });
  await expect(page.getByText("backend · Isolation Forest")).toBeVisible();
  await expect(page.getByText("Risk: low")).toBeVisible({ timeout: LONG });
  const failure = page.getByRole("switch", { name: "Hardware failure" });
  await expect(failure).toHaveAttribute("aria-checked", "false", { timeout: LONG });
  await failure.click();
  await expect(failure).toHaveAttribute("aria-checked", "true", { timeout: LONG });
  await expect(page.getByText(/Risk: (high|critical)/)).toBeVisible({ timeout: LONG });
  await page.screenshot({ path: "e2e/artifacts/02-telemetry-ml-risk.png", fullPage: true });

  // 4. The backend opens exactly one incident; no browser-side duplicate.
  await page.getByRole("link", { name: /^Incidents/ }).click();
  const activeSection = page.locator('section[aria-labelledby="active-heading"]');
  const card = activeSection
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name: "Ultra-Low Freezer A" }) });
  await expect(card).toHaveCount(1, { timeout: LONG });
  await expect(card.getByText(/backend record #\d+/)).toBeVisible();
  await expect(card.getByText(/not a probability of failure/)).toBeVisible();

  // 5. Acknowledge, then generate the backend MILP plan.
  await card.getByRole("button", { name: "Acknowledge" }).click();
  await card.getByRole("button", { name: "Generate rescue plan" }).click();
  await expect(card.getByText("backend · MILP optimizer")).toBeVisible({ timeout: LONG });
  await expect(card.getByText("3 of 3 sample(s) can be relocated.")).toBeVisible();
  // The backend lists every candidate's capacity, but no move may target unrelated equipment.
  await expect(card.getByRole("list", { name: "Proposed moves" }).getByText("Teammate Freezer")).toHaveCount(0);
  await expect(card.getByRole("list", { name: "Proposed moves" }).getByText("Ultra-Low Freezer B")).toHaveCount(3);
  await page.screenshot({ path: "e2e/artifacts/03-incident-plan.png", fullPage: true });

  // 6. Explicit approval, then confirmed atomic execution.
  await card.getByRole("button", { name: "Approve plan" }).click();
  const execute = card.getByRole("button", { name: "Execute rescue" });
  await expect(execute).toBeDisabled({ timeout: LONG });
  await card.getByLabel(/I confirm this simulated transfer/).check();
  await execute.click();
  await expect(card.getByText(/Execution success:/)).toBeVisible({ timeout: LONG });
  await expect(card.getByText(/moved 3 sample\(s\)/)).toBeVisible();
  await page.screenshot({ path: "e2e/artifacts/04-executed.png", fullPage: true });

  // 7. Recovery outcome, clear the simulated fault, then close.
  await card.getByRole("button", { name: "Record recovery" }).click();
  await expect(card.getByLabel(/I confirm closing this incident/)).toBeVisible({ timeout: LONG });
  await card.getByRole("button", { name: "Clear simulated fault" }).click();
  // The model's window must flush the faulty readings before risk returns to low.
  await expect(card.locator(".badge").getByText("low", { exact: true })).toBeVisible({ timeout: 120_000 });
  await card.getByLabel(/I confirm closing this incident/).check();
  await card.getByRole("button", { name: "Close incident" }).click();
  await expect(card).toHaveCount(0, { timeout: LONG });
  const historyItem = page.locator(".history-item", { hasText: "Ultra-Low Freezer A" });
  await expect(historyItem).toHaveCount(1, { timeout: LONG });
  await expect(historyItem.getByText("Closed", { exact: true })).toBeVisible();

  // No phantom incident reopens for the unit after closure.
  await page.waitForTimeout(8_000);
  await expect(card).toHaveCount(0);

  // 8. Audit trail from the backend.
  await historyItem.getByText("Full incident record").click();
  await historyItem.getByText(/Audit trail \(\d+ backend events\)/).click();
  for (const event of ["created", "acknowledged", "plan generated", "plan approved", "execution succeeded", "recovery recorded", "incident closed"]) {
    await expect(historyItem.getByText(event, { exact: true }).first()).toBeVisible({ timeout: LONG });
  }
  await page.screenshot({ path: "e2e/artifacts/05-history.png", fullPage: true });

  // 9. Reset restores the baseline; removal is refused while incident records reference demo units.
  await page.getByRole("link", { name: "Overview" }).click();
  await page.getByRole("button", { name: "Reset demo" }).click();
  await expect(page.getByText(/Returned 3 demo sample\(s\) to their seeded storage/)).toBeVisible({ timeout: LONG });
  await page.getByRole("button", { name: "Remove demo data…" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete demo data" }).click();
  await expect(page.getByText(/removal is disabled to keep the audit trail intact/)).toBeVisible({ timeout: LONG });

  // Unrelated inventory was never modified.
  const teammate = (await (await request.get(`${API}/api/equipment/${teammateId}`)).json()) as {
    status: string;
    used_storage: number;
  };
  expect(teammate.status).toBe("operational");
  expect(teammate.used_storage).toBe(2);
  const teammateSamples = (await (await request.get(`${API}/api/samples?equipment_id=${teammateId}`)).json()) as unknown[];
  expect(teammateSamples).toHaveLength(1);

  expect(pageErrors.map((e) => e.message)).toEqual([]);
});

test("mobile layout and automated accessibility checks", async ({ page }) => {
  const pageErrors = trackPageErrors(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Laboratory Overview" })).toBeVisible({ timeout: LONG });

  for (const [path, heading] of [
    ["/", "Laboratory Overview"],
    ["/incidents", "Incident Response"],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible({ timeout: LONG });
    await page.waitForTimeout(1_500);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious.map((v) => `${v.id}: ${v.nodes.length} node(s) on ${path}`)).toEqual([]);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Laboratory Overview" })).toBeVisible({ timeout: LONG });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: "e2e/artifacts/06-mobile.png", fullPage: true });
  expect(pageErrors.map((e) => e.message)).toEqual([]);
});
