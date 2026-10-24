"""Reproducible demo seed / reset for LabSentinel.

Creates a SEPARATE demo database (``demo.db`` by default, overridable via the
``DEMO_DB`` env var) populated with a realistic scenario so the project can be
demonstrated repeatedly without touching the real ``labsentinel.db``.

Usage (from the ``backend`` directory, with the venv active):

    # reset + seed the demo database, then print how to run against it
    python -m scripts.demo_seed

    # just wipe the demo database back to empty
    python -m scripts.demo_seed --reset

    # seed, then launch the API against the demo DB
    python -m scripts.demo_seed --serve

The seeded scenario:
  * one healthy ultra-low freezer with spare capacity (rescue target),
  * one healthy backup freezer,
  * one warm fridge (incompatible - demonstrates infeasible placement),
  * a primary freezer that will be driven into failure, holding a mix of
    high/critical/low priority samples (demonstrates complete, partial and
    priority-aware rescue).

Nothing here imports or mutates the production database.
"""

from __future__ import annotations

import argparse
import os
import sys

# Point the whole app at the demo database BEFORE importing app modules.
DEMO_DB = os.environ.get("DEMO_DB", "demo.db")
os.environ["DATABASE_URL"] = f"sqlite:///./{DEMO_DB}"
# Keep the demo model file separate from production too.
os.environ.setdefault("ANOMALY_MODEL_PATH", "./demo_anomaly_model.joblib")


def _reset_schema():
    from app.database import Base, engine
    import app.models  # noqa: F401  (register all models)

    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)


def seed() -> dict:
    """Reset the demo DB and populate the demo scenario. Returns a summary."""
    _reset_schema()

    from app.database import SessionLocal
    from app.crud import equipment as equipment_crud
    from app.crud import sample as sample_crud
    from app.schemas.equipment import EquipmentCreate
    from app.schemas.sample import SampleCreate

    db = SessionLocal()
    created = {"equipment": {}, "samples": []}
    try:
        # --- Equipment ---------------------------------------------------
        primary = equipment_crud.create_equipment(db, EquipmentCreate(
            name="ULT Freezer A (primary)", type="freezer", location="Lab 1",
            min_temperature=-85.0, max_temperature=-65.0,
            storage_capacity=20, sample_limit=10, status="operational"))
        backup = equipment_crud.create_equipment(db, EquipmentCreate(
            name="ULT Freezer B (backup)", type="freezer", location="Lab 2",
            min_temperature=-85.0, max_temperature=-65.0,
            storage_capacity=12, sample_limit=10, status="operational"))
        backup2 = equipment_crud.create_equipment(db, EquipmentCreate(
            name="ULT Freezer C (backup)", type="freezer", location="Lab 3",
            min_temperature=-85.0, max_temperature=-65.0,
            storage_capacity=6, sample_limit=10, status="operational"))
        fridge = equipment_crud.create_equipment(db, EquipmentCreate(
            name="Vaccine Fridge (incompatible)", type="fridge", location="Lab 1",
            min_temperature=2.0, max_temperature=8.0,
            storage_capacity=50, sample_limit=None, status="operational"))
        created["equipment"] = {
            "primary": primary.id, "backup": backup.id,
            "backup2": backup2.id, "fridge": fridge.id,
        }

        # --- Samples on the primary (the ones that will need rescue) -----
        # Total storage 5+5+4+3+3 = 20 == primary capacity (fills it exactly).
        # Backups hold 12 + 6 = 18, so not everything fits -> the optimiser
        # produces a priority-aware PARTIAL rescue (low priority left behind),
        # which is great for the demo.
        specs = [
            ("Patient Plasma (critical)", -82.0, -70.0, 5, "critical"),
            ("Vaccine Lot 1 (high)", -82.0, -70.0, 5, "high"),
            ("Vaccine Lot 2 (high)", -82.0, -70.0, 4, "high"),
            ("Research Cells (medium)", -82.0, -70.0, 3, "medium"),
            ("Spare Reagent (low)", -82.0, -70.0, 3, "low"),
        ]
        for name, lo, hi, space, pr in specs:
            s = sample_crud.create_sample(db, SampleCreate(
                name=name, equipment_id=primary.id,
                min_temperature=lo, max_temperature=hi,
                storage_space=space, priority=pr))
            created["samples"].append({"id": s.id, "name": name,
                                       "priority": pr, "storage": space})
        db.commit()
    finally:
        db.close()

    return created


def reset_only():
    _reset_schema()


def main(argv=None):
    parser = argparse.ArgumentParser(description="LabSentinel demo seed/reset")
    parser.add_argument("--reset", action="store_true",
                        help="wipe the demo database to empty and exit")
    parser.add_argument("--serve", action="store_true",
                        help="after seeding, run the API against the demo DB")
    args = parser.parse_args(argv)

    if args.reset:
        reset_only()
        print(f"Demo database '{DEMO_DB}' reset to empty.")
        return 0

    summary = seed()
    print("Seeded demo database:", DEMO_DB)
    print("  equipment ids:", summary["equipment"])
    print("  samples:")
    for s in summary["samples"]:
        print(f"    #{s['id']:>2}  {s['name']:<28} "
              f"priority={s['priority']:<8} storage={s['storage']}")
    print()
    print("Demo flow (primary =", summary["equipment"]["primary"], "):")
    print("  1. POST /api/simulation/start  {\"interval_seconds\": 1}")
    print("  2. POST /api/simulation/equipment/"
          f"{summary['equipment']['primary']}/fail  {{\"enabled\": true}}")
    print("     -> telemetry + anomaly detection raise a critical alert and "
          "open an incident")
    print("  3. GET  /api/incidents                (find the incident id)")
    print("  4. POST /api/incidents/{id}/plan      (MILP rescue plan)")
    print("  5. POST /api/incidents/{id}/plan/approve "
          "{\"acknowledge_unrescued\": true}")
    print("  6. POST /api/incidents/{id}/plan/execute (simulated transfer)")
    print("  7. GET  /api/incidents/{id}/plan/execution")

    if args.serve:
        import uvicorn
        uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=False)
    else:
        print()
        print("To run the API against this demo database:")
        print(f'  $env:DATABASE_URL = "sqlite:///./{DEMO_DB}"')
        print('  $env:ANOMALY_MODEL_PATH = "./demo_anomaly_model.joblib"')
        print("  uvicorn app.main:app")
    return 0


if __name__ == "__main__":
    sys.exit(main())
