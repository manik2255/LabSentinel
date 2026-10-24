import { NavLink, Route, Routes } from "react-router-dom";
import { OverviewPage } from "./pages/OverviewPage";
import { EquipmentDetailPage } from "./pages/EquipmentDetailPage";
import { IncidentsPage } from "./pages/IncidentsPage";
import { ConnectionIndicator } from "./components/ConnectionIndicator";
import { SimulatorIndicator } from "./components/SimulatorIndicator";
import { useIncidentStore } from "./store/incidentStore";
import "./app.css";

function IncidentNavBadge() {
  const { activeByEquipment } = useIncidentStore();
  const count = activeByEquipment.size;
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
          Telemetry and risk assessment come from the backend. Rescue planning and incident
          tracking still run in this browser.
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
