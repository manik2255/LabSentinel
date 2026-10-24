import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Browser E2E for the LabSentinel demo. playwright.config.ts starts a
 * dedicated backend with a fresh, disposable SQLite database for every run,
 * so these tests never touch a developer's working data.
 */

const API = "http://127.0.0.1:8078";
const LONG = 20_000;

function trackPageErrors(page: Page): Error[] {
  const errors: Error[] = [];
  page.on("pageerror", (err) => errors.push(err));
  page.on("console", (msg) => {
    if (msg.type() === "error") console.log(`[console.error] ${msg.text()}`);
  });
  return errors;
}

async function seedTeammateRecord(request: APIRequestContext) {
  const unit = await request.post(`${API}/api/equipment`, {
    data: {
      name: "Teammate Freezer",
      type: "Freezer",
      location: "Building 4",
      min_temperature: -90,
      max_temperature: -60,
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
      min_temperature: -80,
      max_temperature: -70,
      storage_space: 2,
      priority: "high",
    },
  });
  expect(sample.ok()).toBe(true);
  return eq.id;
}

test("full demo journey with safety boundaries, reset, and replay", async ({ page, request }) => {
  const pageErrors = trackPageErrors(page);

  // Unrelated inventory that every demo operation must leave untouched.
  const teammateId = await seedTeammateRecord(request);

  // 1. Overview and backend connection.
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Laboratory Overview" })).toBeVisible({ timeout: LONG });
  await expect(page.getByText("Backend online")).toBeVisible({ timeout: LONG });
  await expect(page.getByText("Demonstration environment.")).toBeVisible();

  // 2. Set up the demo (creates the demo lab and starts the simulator).
  await page.getByRole("button", { name: "Set up demo" }).first().click();
  await expect(page.getByRole("heading", { name: "Ultra-Low Freezer A" })).toBeVisible({ timeout: LONG });
  await expect(page.getByText(/Created 4 demo units and 5 demo samples/)).toBeVisible({ timeout: LONG });

  // 3. Healthy lab: fresh readings, no incident.
  await expect(page.getByText(/All \d+ unit\(s\) with fresh readings are within/)).toBeVisible({ timeout: LONG });
  await page.screenshot({ path: "e2e/artifacts/01-overview-healthy.png", fullPage: true });

  // 4. Fault injection is disabled for equipment outside the demo lab.
  await page.getByRole("link", { name: /Telemetry & controls for Teammate Freezer/ }).click();
  await expect(page.getByText(/Fault injection is limited to demo units/)).toBeVisible({ timeout: LONG });
  await expect(page.getByRole("switch", { name: "Hardware failure" })).toBeDisabled();

  // 5. Open the demo freezer and inject a simulated hardware failure.
  await page.getByRole("link", { name: "Overview" }).click();
  await page.getByRole("link", { name: /Telemetry & controls for Ultra-Low Freezer A/ }).click();
  await expect(page.getByRole("heading", { name: "Temperature Telemetry" })).toBeVisible({ timeout: LONG });
  const failure = page.getByRole("switch", { name: "Hardware failure" });
  await expect(failure).toHaveAttribute("aria-checked", "false", { timeout: LONG });
  await failure.click();
  await expect(failure).toHaveAttribute("aria-checked", "true", { timeout: LONG });

  // 6. Risk detection is visible on the telemetry page.
  await expect(page.getByRole("heading", { name: "Ultra-Low Freezer A" }).locator("..").getByText("Critical")).toBeVisible({ timeout: LONG });
  await expect(page.getByText(/out-of-range reading\(s\) marked in red/)).toBeVisible({ timeout: LONG });
  await page.screenshot({ path: "e2e/artifacts/02-telemetry-fault.png", fullPage: true });

  // 7. Incident workspace: evidence and rescue proposal.
  await page.getByRole("link", { name: /^Incidents/ }).click();
  await expect(page.getByRole("heading", { name: "Incident Response" })).toBeVisible();
  const incident = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Ultra-Low Freezer A" }) }).first();
  await expect(incident).toBeVisible({ timeout: LONG });
  await expect(incident.getByText("Not known from this data")).toBeVisible();
  await expect(incident.getByText(/not a probability of failure/)).toBeVisible();
  await expect(incident.getByText("Full plan")).toBeVisible();
  await expect(incident.getByText(/3 sample\(s\) at risk in Ultra-Low Freezer A/)).toBeVisible();
  // The demo sandbox never proposes moves into non-demo equipment.
  await expect(incident.getByText("Teammate Freezer")).toHaveCount(0);

  // 8. Human action: execution is locked until acknowledged.
  const execute = incident.getByRole("button", { name: "Execute rescue" });
  await expect(execute).toBeDisabled();
  await incident.getByRole("button", { name: "Acknowledge" }).click();
  await expect(execute).toBeEnabled();
  await page.screenshot({ path: "e2e/artifacts/03-incident-plan.png", fullPage: true });

  // 9. Confirmation: Escape cancels without sending moves.
  await execute.click();
  const dialog = page.getByRole("alertdialog", { name: /Execute rescue in the demo environment/ });
  await expect(dialog).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(execute).toBeFocused();

  // 10. Confirm and execute; each move is confirmed by the backend.
  await execute.click();
  await dialog.getByRole("button", { name: "Confirm & execute" }).click();
  await expect(incident.getByText(/3 of 3 move\(s\) confirmed by the backend/)).toBeVisible({ timeout: LONG });
  await page.screenshot({ path: "e2e/artifacts/04-executed.png", fullPage: true });

  // 11. Operational recovery verification.
  await incident.getByRole("button", { name: "Verify recovery" }).click();
  await expect(page.getByRole("heading", { name: /Incident history \(1\)/ })).toBeVisible({ timeout: LONG });
  await expect(page.getByText(/3 of 3 sample location\(s\) verified/)).toBeVisible();
  await expect(page.getByText(/Sample viability not assessed/)).toBeVisible();

  // 12. Incident records survive a reload (browser-local storage).
  await page.reload();
  await expect(page.getByRole("heading", { name: /Incident history \(1\)/ })).toBeVisible({ timeout: LONG });
  await expect(page.getByRole("heading", { name: /Active incidents \(0\)/ })).toBeVisible();
  await page.screenshot({ path: "e2e/artifacts/05-history.png", fullPage: true });

  // 13. Reset restores the baseline without deleting anything.
  await page.getByRole("link", { name: "Overview" }).click();
  await page.getByRole("button", { name: "Reset demo" }).click();
  await expect(page.getByText(/Returned 3 demo sample\(s\) to their seeded storage/)).toBeVisible({ timeout: LONG });
  await expect(page.getByText(/1 non-demo unit\(s\) were not touched/)).toBeVisible();

  // The reset unit re-arms on a healthy reading, then a second failure is
  // detected as a new incident (repeatable demo).
  await expect(page.getByText(/All \d+ unit\(s\) with fresh readings are within/)).toBeVisible({ timeout: 30_000 });
  await page.getByRole("link", { name: /Telemetry & controls for Ultra-Low Freezer A/ }).click();
  const failureAgain = page.getByRole("switch", { name: "Hardware failure" });
  await expect(failureAgain).toHaveAttribute("aria-checked", "false", { timeout: LONG });
  await failureAgain.click();
  await expect(failureAgain).toHaveAttribute("aria-checked", "true", { timeout: LONG });
  await page.getByRole("link", { name: /^Incidents/ }).click();
  await expect(page.getByRole("heading", { name: /Active incidents \(1\)/ })).toBeVisible({ timeout: LONG });

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
});

test("mobile layout and automated accessibility checks", async ({ page }) => {
  const pageErrors = trackPageErrors(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Laboratory Overview" })).toBeVisible({ timeout: LONG });
  await page.getByRole("button", { name: "Set up demo" }).first().click();
  await expect(page.getByRole("heading", { name: "Ultra-Low Freezer A" })).toBeVisible({ timeout: LONG });

  for (const [path, heading] of [
    ["/", "Laboratory Overview"],
    ["/incidents", "Incident Response"],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible({ timeout: LONG });
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
