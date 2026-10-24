import { NavLink, Route, Routes } from "react-router-dom";
import { OverviewPage } from "./pages/OverviewPage";
import { EquipmentDetailPage } from "./pages/EquipmentDetailPage";
import { IncidentsPage } from "./pages/IncidentsPage";
import { ConnectionIndicator } from "./components/ConnectionIndicator";
import { SimulatorIndicator } from "./components/SimulatorIndicator";
import { LabWideDetection } from "./components/IncidentDetector";
import { useIncidentStore } from "./store/incidentStore";
import { useBackendIncidents, useCapabilities } from "./hooks/queries";
import "./app.css";

/**
 * Browser-side detection runs only when the backend has no incident API, so
 * a backend that owns incidents never gets a duplicate browser workflow.
 */
function DetectionOwner() {
  const caps = useCapabilities();
  if (!caps.data || caps.data.incidents) return null;
  return <LabWideDetection />;
}

function IncidentNavBadge() {
  const caps = useCapabilities();
  const backend = caps.data?.incidents === true;
  const backendIncidents = useBackendIncidents(backend);
  const { activeByEquipment } = useIncidentStore();
  const count = backend
    ? (backendIncidents.data ?? []).filter((i) => i.status !== "closed").length
    : activeByEquipment.size;
  if (count === 0) return null;
  return (
    <span className="badge badge-critical" style={{ marginLeft: 8 }}>
      {count}
      <span className="visually-hidden"> active</span>
    </span>
  );
}

export default function App() {
  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">
        Skip to main content
      </a>
      <DetectionOwner />
      <aside className="app-nav">
        <div className="app-brand">
          <span className="app-brand-mark" aria-hidden>
            ◈
          </span>
          <div>
            <div className="app-brand-name">LabSentinel</div>
            <div className="app-brand-sub">Lab Operations Console</div>
          </div>
        </div>
        <nav className="stack" style={{ gap: 4 }} aria-label="Primary">
          <NavLink to="/" end className="nav-link">
            Overview
          </NavLink>
          <NavLink to="/incidents" className="nav-link">
            Incidents
            <IncidentNavBadge />
          </NavLink>
        </nav>
        <div className="app-nav-foot muted">
          Telemetry comes from the backend simulator. Risk, incidents, and rescue plans come from
          the backend when it provides them; otherwise they run in this browser.
        </div>
      </aside>

      <div className="app-main">
        <header className="app-header">
          <span className="sim-pill" title="No physical sensors are connected">
            Demo · simulated telemetry
          </span>
          <div className="row header-status">
            <SimulatorIndicator />
            <ConnectionIndicator />
          </div>
        </header>
        <main id="main" tabIndex={-1} className="app-content">
          <Routes>
            <Route path="/" element={<OverviewPage />} />
            <Route path="/equipment/:id" element={<EquipmentDetailPage />} />
            <Route path="/incidents" element={<IncidentsPage />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
