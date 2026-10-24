"""Anomaly detection package (Phase 3).

Provides feature engineering, an Isolation Forest based anomaly detector,
explainable risk-level scoring, and a detection service that turns readings
into alerts.
"""

from app.detection.model import AnomalyDetector, detector

__all__ = ["AnomalyDetector", "detector"]
