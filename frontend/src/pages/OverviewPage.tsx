import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQueries } from "@tanstack/react-query";
import {
  latestReadingQuery,
  useCapabilities,
  useEquipmentList,
  useSamples,
} from "../hooks/queries";
import { EquipmentCard } from "../components/EquipmentCard";
import { EmptyState, QueryBoundary } from "../components/QueryState";
import { useDemoControls } from "../hooks/useDemoControls";
import { LabHealthSummary, summarize, type UnitHealth } from "../components/LabHealthSummary";
import { classifyEquipment } from "../domain/detection";
import { demoInventory } from "../domain/demoScope";
import { useNow } from "../lib/clock";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import { ArrowRightIcon } from "../components/Icons";

export function OverviewPage() {
  useDocumentTitle("Laboratory Overview");
  const caps = useCapabilities();
  const equipment = useEquipmentList();
  const samples = useSamples();
  const demo = useDemoControls();
  const now = useNow();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const removeDialogRef = useRef<HTMLDivElement>(null);
  const removeButtonRef = useRef<HTMLButtonElement>(null);

  const list = equipment.data ?? [];
  const latest = useQueries({ queries: list.map((e) => latestReadingQuery(e.id)) });
  const units: UnitHealth[] = list.map((e, i) => ({
    equipment: e,
    classification: classifyEquipment({
      equipment: e,
      latestReading: latest[i]?.data ?? null,
      now,
    }),
  }));
  const counts = summarize(units);
  const critical = units.filter((u) => u.classification.health === "critical");
  const inventory = demoInventory(list, samples.data ?? []);

  useEffect(() => {
    if (confirmRemove) removeDialogRef.current?.focus();
  }, [confirmRemove]);

  const closeRemove = () => {
    setConfirmRemove(false);
    removeButtonRef.current?.focus();
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Laboratory Overview</h1>
          <p className="page-subtitle">Live equipment health, temperature, and storage capacity.</p>
        </div>
        <div className="row button-row">
          <button className="btn btn-primary" disabled={demo.busy} onClick={() => void demo.setUp()}>
            {demo.busy ? "Working…" : "Set up demo"}
          </button>
          <button
            className="btn"
            disabled={demo.busy}
            onClick={() => void demo.reset()}
            title="Restores the demo baseline. Deletes nothing."
          >
            Reset demo
          </button>
          <button
            ref={removeButtonRef}
            className="btn btn-danger"
            disabled={demo.busy || inventory.equipment.length === 0}
            onClick={() => setConfirmRemove(true)}
          >
            Remove demo data…
          </button>
        </div>
      </div>

      <p className="notice notice-sim">
        <strong>Demonstration environment.</strong> Temperatures come from the backend simulator; no
        physical sensors are connected.{" "}
        {caps.data?.incidents
          ? "ML risk assessment, incident tracking, rescue planning, and rescue execution are handled by the backend."
          : caps.data
            ? "This backend has no incident API, so assessment, rescue planning, and incident tracking run in this browser and are labeled as browser-derived."
            : null}
      </p>

      {confirmRemove ? (
        <div
          ref={removeDialogRef}
          tabIndex={-1}
          className="card confirm-dialog"
          role="alertdialog"
          aria-labelledby="remove-title"
          aria-describedby="remove-body"
          onKeyDown={(e) => {
            if (e.key === "Escape") closeRemove();
          }}
        >
          <h2 id="remove-title" className="section-title" style={{ marginTop: 0 }}>
            Permanently delete demo data?
          </h2>
          <p id="remove-body" style={{ fontSize: "var(--fs-sm)" }}>
            This deletes {inventory.equipment.length} demo unit(s) and {inventory.samples.length}{" "}
            demo sample(s) from the backend (records in “Demo Lab” locations). It cannot be undone.{" "}
            {inventory.otherEquipmentCount} other unit(s) and {inventory.otherSampleCount} other
            sample(s) are not affected. Use Reset demo to restore the demo without deleting.
          </p>
          <div className="row" style={{ gap: "var(--space-2)" }}>
            <button
              className="btn btn-danger"
              onClick={() => {
                setConfirmRemove(false);
                void demo.removeDemoData();
              }}
            >
              Delete demo data
            </button>
            <button className="btn" onClick={closeRemove}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {demo.report ? (
        <div
          className={`card report ${demo.report.error ? "result-critical" : ""}`}
          role="status"
          aria-live="polite"
        >
          <strong>{demo.report.title}</strong>
          <ul className="result-list">
            {demo.report.actions.map((a) => (
              <li key={a}>{a}</li>
            ))}
            {demo.report.error ? (
              <li className="text-critical">Failed: {demo.report.error}</li>
            ) : null}
          </ul>
        </div>
      ) : null}

      <QueryBoundary
        query={equipment}
        empty={(d) => d.length === 0}
        emptyNode={
          <EmptyState
            title="No equipment yet"
            hint="Set up the demo to create two ultra-low freezers, a vaccine fridge, and an incubator with sample inventory, then start the simulator."
            action={
              <button
                className="btn btn-primary"
                disabled={demo.busy}
                onClick={() => void demo.setUp()}
              >
                Set up demo
              </button>
            }
          />
        }
      >
        {() => (
          <>
            {critical.length > 0 ? (
              <div className="attention attention-critical" role="status" aria-live="polite">
                <strong>
                  {critical.length} unit{critical.length > 1 ? "s" : ""} critical:
                </strong>{" "}
                {critical
                  .map((u) => `${u.equipment.name} — ${u.classification.reasons[0]?.message ?? "critical"}`)
                  .join("; ")}
                <Link to="/incidents" className="attention-link">
                  Open incident response <ArrowRightIcon size={14} />
                </Link>
              </div>
            ) : counts.attention > 0 ? (
              <div className="attention attention-warn" role="status" aria-live="polite">
                <strong>{counts.attention} unit(s) need attention</strong> (stale telemetry or close
                to a limit). No incident is open.
              </div>
            ) : counts.noData === units.length ? (
              <div className="attention" role="status" aria-live="polite">
                Awaiting telemetry. Start the simulator from the header.
              </div>
            ) : (
              <div className="attention attention-ok" role="status" aria-live="polite">
                All {counts.healthy} unit(s) with fresh readings are within their allowed ranges.
              </div>
            )}
            <LabHealthSummary units={units} />
            <div className="grid grid-cards" style={{ marginTop: "var(--space-4)" }}>
              {list.map((e) => (
                <EquipmentCard key={e.id} equipment={e} />
              ))}
            </div>
          </>
        )}
      </QueryBoundary>
    </div>
  );
}
