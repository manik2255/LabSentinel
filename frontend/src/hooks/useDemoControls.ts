/**
 * Demo setup, reset, and removal over the real endpoints (Req 8).
 *
 * Every operation is restricted to demo-owned records (see domain/demoScope):
 * equipment and samples that are not part of the demo lab are never modified
 * or deleted, even when they share the backend database.
 *
 *  - setUp:  creates the demo lab if it does not exist, starts the simulator.
 *  - reset:  non-destructive. Clears demo fault flags, returns demo samples to
 *            their seeded storage (re-creating any that are missing), restores
 *            demo units to "operational", and clears active demo incidents.
 *  - remove: destructive, demo-only. Deletes demo samples and demo equipment.
 *            The UI requires an explicit confirmation before calling it.
 */
import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import * as api from "../api/endpoints";
import { ApiError } from "../api/client";
import { DEMO_SIM_INTERVAL_SECONDS, SEED_EQUIPMENT, SEED_SAMPLES } from "../config";
import { demoInventory, isDemoEquipment } from "../domain/demoScope";
import type { EquipmentRead } from "../api/types";
import { queryKeys } from "./queries";
import { useIncidentStore } from "../store/incidentStore";

export interface DemoReport {
  title: string;
  actions: string[];
  error?: string;
}

function message(err: unknown): string {
  if (err instanceof ApiError) return err.detail;
  if (err instanceof Error) return err.message;
  return String(err);
}

export function useDemoControls() {
  const qc = useQueryClient();
  const incidents = useIncidentStore();
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<DemoReport | null>(null);

  const invalidateAll = useCallback(() => {
    void qc.invalidateQueries({ queryKey: queryKeys.equipment });
    void qc.invalidateQueries({ queryKey: ["samples"] });
    void qc.invalidateQueries({ queryKey: queryKeys.simStatus });
    void qc.invalidateQueries({ queryKey: ["latest"] });
    void qc.invalidateQueries({ queryKey: ["history"] });
  }, [qc]);

  const run = useCallback(
    async (title: string, body: (actions: string[]) => Promise<void>) => {
      setBusy(true);
      const actions: string[] = [];
      try {
        await body(actions);
        setReport({ title, actions });
      } catch (err) {
        setReport({ title, actions, error: message(err) });
      } finally {
        invalidateAll();
        setBusy(false);
      }
    },
    [invalidateAll],
  );

  const setUp = useCallback(
    () =>
      run("Set up demo", async (actions) => {
        const existing = (await api.listEquipment()).filter(isDemoEquipment);
        if (existing.length > 0) {
          actions.push(`Demo lab already present (${existing.length} units); nothing created.`);
        } else {
          const created: EquipmentRead[] = [];
          for (const e of SEED_EQUIPMENT) created.push(await api.createEquipment({ ...e }));
          let samples = 0;
          for (const s of SEED_SAMPLES) {
            const home = created[s.equipmentIndex];
            if (!home) continue;
            await api.createSample({
              name: s.name,
              equipment_id: home.id,
              min_temperature: s.min_temperature,
              max_temperature: s.max_temperature,
              storage_space: s.storage_space,
              priority: s.priority,
            });
            samples += 1;
          }
          actions.push(`Created ${created.length} demo units and ${samples} demo samples.`);
        }
        const status = await api.startSimulation({ interval_seconds: DEMO_SIM_INTERVAL_SECONDS });
        actions.push(
          `Simulator running (a reading every ${status.interval_seconds ?? DEMO_SIM_INTERVAL_SECONDS} s).`,
        );
      }),
    [run],
  );

  const reset = useCallback(
    () =>
      run("Reset demo", async (actions) => {
        const [status, equipment, samples] = await Promise.all([
          api.getSimulationStatus(),
          api.listEquipment(),
          api.listSamples(),
        ]);
        const demo = demoInventory(equipment, samples);
        if (demo.equipment.length === 0) {
          actions.push("No demo lab found; nothing to reset. Use Set up demo.");
          return;
        }
        const demoIds = new Set(demo.equipment.map((e) => e.id));

        // 1. Clear fault flags on demo units only.
        let flags = 0;
        for (const id of status.abnormal_equipment_ids) {
          if (!demoIds.has(id)) continue;
          await api.setAbnormal(id, { enabled: false });
          flags += 1;
        }
        for (const id of status.failed_equipment_ids) {
          if (!demoIds.has(id)) continue;
          await api.setFailed(id, { enabled: false });
          flags += 1;
        }
        actions.push(`Cleared ${flags} demo fault flag(s).`);

        // 2. Return demo samples to their seeded storage; re-create missing ones.
        const byName = new Map(demo.equipment.map((e) => [e.name, e]));
        let returned = 0;
        let recreated = 0;
        for (const seed of SEED_SAMPLES) {
          const homeName = SEED_EQUIPMENT[seed.equipmentIndex]?.name;
          const home = homeName ? byName.get(homeName) : undefined;
          if (!home) continue;
          const current = demo.samples.find((s) => s.name === seed.name);
          if (!current) {
            await api.createSample({
              name: seed.name,
              equipment_id: home.id,
              min_temperature: seed.min_temperature,
              max_temperature: seed.max_temperature,
              storage_space: seed.storage_space,
              priority: seed.priority,
            });
            recreated += 1;
          } else if (current.equipment_id !== home.id) {
            await api.updateSample(current.id, { equipment_id: home.id });
            returned += 1;
          }
        }
        actions.push(
          `Returned ${returned} demo sample(s) to their seeded storage${
            recreated ? `; re-created ${recreated}` : ""
          }.`,
        );

        // 3. A simulated hardware failure leaves the unit "offline" in the
        // backend even after the flag is cleared; restore demo units.
        let restored = 0;
        for (const e of demo.equipment) {
          if (e.status === "operational") continue;
          await api.updateEquipment(e.id, { status: "operational" });
          restored += 1;
        }
        actions.push(`Restored ${restored} demo unit(s) to operational.`);

        // 4. Clear active demo incidents; resolved ones stay in the history.
        incidents.clearEquipment([...demoIds], { keepResolved: true });
        actions.push("Cleared active demo incidents (resolved history kept).");
        actions.push(
          status.running
            ? "Simulator left running; readings return to normal on the next tick."
            : "Simulator is stopped; start it from the header to resume telemetry.",
        );
        if (demo.otherEquipmentCount > 0) {
          actions.push(`${demo.otherEquipmentCount} non-demo unit(s) were not touched.`);
        }
      }),
    [incidents, run],
  );

  const removeDemoData = useCallback(
    () =>
      run("Remove demo data", async (actions) => {
        const [status, equipment, samples] = await Promise.all([
          api.getSimulationStatus(),
          api.listEquipment(),
          api.listSamples(),
        ]);
        const demo = demoInventory(equipment, samples);
        const demoIds = new Set(demo.equipment.map((e) => e.id));

        for (const id of status.abnormal_equipment_ids) {
          if (demoIds.has(id)) await api.setAbnormal(id, { enabled: false });
        }
        for (const id of status.failed_equipment_ids) {
          if (demoIds.has(id)) await api.setFailed(id, { enabled: false });
        }

        let deletedSamples = 0;
        for (const s of demo.samples) {
          await api.deleteSample(s.id);
          deletedSamples += 1;
        }
        let deletedUnits = 0;
        const kept: string[] = [];
        for (const e of demo.equipment) {
          try {
            await api.deleteEquipment(e.id);
            deletedUnits += 1;
          } catch (err) {
            // 409: the unit still holds a sample that is not a demo sample.
            if (err instanceof ApiError && err.status === 409) kept.push(e.name);
            else throw err;
          }
        }
        incidents.clearEquipment([...demoIds], { keepResolved: false });
        actions.push(`Deleted ${deletedSamples} demo sample(s) and ${deletedUnits} demo unit(s).`);
        if (kept.length) {
          actions.push(`Kept ${kept.join(", ")}: still holds samples that are not demo data.`);
        }
        actions.push(
          `${demo.otherEquipmentCount} non-demo unit(s) and ${demo.otherSampleCount} non-demo sample(s) were not touched.`,
        );
      }),
    [incidents, run],
  );

  return { setUp, reset, removeDemoData, busy, report };
}
