"""ORM models package.

Importing the models here ensures they are all registered on the shared
declarative Base metadata, so that create_all can build every table.
"""

from app.models.alert import Alert
from app.models.equipment import Equipment
from app.models.sample import Sample
from app.models.sensor_reading import SensorReading

__all__ = [
    "Alert",
    "Equipment",
    "Sample",
    "SensorReading",
]
