"""Background temperature simulator.

Generates synthetic ``SensorReading`` rows for every piece of equipment at a
fixed interval, without any real sensors. Designed as a process-wide singleton
so that starting it twice never spawns duplicate loops.

Behaviour per equipment on each tick:

* **normal** - a value sampled near the middle of the equipment's temperature
  range, with small random drift, clamped to stay inside the range.
* **abnormal** - a value pushed outside the equipment's range (either above
  ``max_temperature`` or below ``min_temperature``) to mimic a dangerous
  excursion.
* **failed** - the equipment is treated as broken: it is marked ``offline`` and
  emits a stuck/extreme reading, simulating a hardware failure.

The loop runs in a daemon thread. All database access inside the thread uses a
fresh short-lived session (never a request-scoped session).
"""

from __future__ import annotations

import random
import threading
from typing import Optional

from app.database import SessionLocal
from app.models.equipment import Equipment


class TemperatureSimulator:
    """A thread-based, singleton-friendly temperature reading generator."""

    def __init__(self) -> None:
        # Guards start/stop transitions so concurrent calls cannot create
        # two threads.
        self._lock = threading.RLock()
        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()

        self._interval_seconds: float = 5.0
        self._ticks: int = 0

        # Per-equipment condition flags (equipment_id sets).
        self._abnormal: set[int] = set()
        self._failed: set[int] = set()

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------
    @property
    def running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def start(self, interval_seconds: float = 5.0) -> bool:
        """Start the simulation loop.

        Returns True if a new loop was started, False if one was already
        running (no duplicate thread is created).
        """
        with self._lock:
            if self.running:
                return False
            self._interval_seconds = interval_seconds
            self._ticks = 0
            self._stop_event.clear()
            self._thread = threading.Thread(
                target=self._run,
                name="temperature-simulator",
                daemon=True,
            )
            self._thread.start()
            return True

    def stop(self) -> bool:
        """Stop the simulation loop.

        Returns True if a running loop was stopped, False if nothing was
        running.
        """
        with self._lock:
            if not self.running:
                self._thread = None
                return False
            self._stop_event.set()
            thread = self._thread

        # Join outside the lock so the worker can finish its current tick.
        if thread is not None:
            thread.join(timeout=self._interval_seconds + 5.0)

        with self._lock:
            self._thread = None
            # Clean up simulation state so a later start begins fresh and no
            # fault-injection flags silently carry over across runs.
            self._abnormal.clear()
            self._failed.clear()
            self._ticks = 0
        return True

    # ------------------------------------------------------------------
    # Condition toggles
    # ------------------------------------------------------------------
    def set_abnormal(self, equipment_id: int, enabled: bool) -> None:
        with self._lock:
            if enabled:
                self._abnormal.add(equipment_id)
            else:
                self._abnormal.discard(equipment_id)

    def set_failed(self, equipment_id: int, enabled: bool) -> None:
        with self._lock:
            if enabled:
                self._failed.add(equipment_id)
            else:
                self._failed.discard(equipment_id)

    def status(self) -> dict:
        with self._lock:
            return {
                "running": self.running,
                "interval_seconds": self._interval_seconds if self.running else None,
                "ticks": self._ticks,
                "abnormal_equipment_ids": sorted(self._abnormal),
                "failed_equipment_ids": sorted(self._failed),
            }

    # ------------------------------------------------------------------
    # Core loop
    # ------------------------------------------------------------------
    def _run(self) -> None:
        """Thread target: emit one batch of readings per interval until stopped."""
        # Emit an immediate first batch, then wait between subsequent ticks.
        while not self._stop_event.is_set():
            try:
                self._tick_once()
            except Exception:  # noqa: BLE001 - never let the loop die silently
                # In a real system this would be logged; keep the loop alive.
                pass
            with self._lock:
                self._ticks += 1
            # Wait returns early (True) if stop is signalled during the sleep.
            self._stop_event.wait(self._interval_seconds)

    def _tick_once(self) -> None:
        """Generate and persist one reading per piece of equipment."""
        with self._lock:
            abnormal = set(self._abnormal)
            failed = set(self._failed)

        # Each tick uses its own session; import here to avoid a circular
        # import at module load time.
        from app.crud.sensor_reading import record_reading

        db = SessionLocal()
        try:
            equipment_list = db.query(Equipment).all()
            for eq in equipment_list:
                temperature = self._generate_temperature(
                    eq,
                    abnormal=eq.id in abnormal,
                    failed=eq.id in failed,
                )
                record_reading(db, eq.id, temperature)

                # A failed equipment is marked offline to reflect the fault.
                if eq.id in failed and eq.status != "offline":
                    eq.status = "offline"
                    db.add(eq)
                    db.commit()
        finally:
            db.close()

    @staticmethod
    def _generate_temperature(
        equipment: Equipment, *, abnormal: bool, failed: bool
    ) -> float:
        """Produce a temperature value for one equipment according to its mode."""
        lo = equipment.min_temperature
        hi = equipment.max_temperature
        span = max(hi - lo, 1.0)

        if failed:
            # Simulate a sensor/hardware failure: a wild, clearly broken value
            # far outside any sane range.
            return round(hi + span * random.uniform(3.0, 5.0), 2)

        if abnormal:
            # Push outside the valid range on a random side.
            if random.random() < 0.5:
                return round(hi + random.uniform(0.5, span), 2)
            return round(lo - random.uniform(0.5, span), 2)

        # Normal: centre of the range plus small drift, clamped to the range.
        centre = (lo + hi) / 2.0
        drift = random.uniform(-span * 0.25, span * 0.25)
        value = centre + drift
        value = max(lo, min(hi, value))
        return round(value, 2)


# Process-wide singleton used by the API layer.
simulator = TemperatureSimulator()
