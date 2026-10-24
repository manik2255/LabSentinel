"""Database connection, session management, and declarative base.

Uses SQLite via SQLAlchemy. The engine, session factory, and Base defined
here are shared across the application and model modules.
"""

from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

# SQLite database stored alongside the backend package.
SQLALCHEMY_DATABASE_URL = "sqlite:///./labsentinel.db"

# check_same_thread is required for SQLite when used with multiple threads
# (as FastAPI/uvicorn does by default).
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    """Declarative base class for all ORM models."""


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency that yields a database session and closes it after use."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def create_all_tables() -> None:
    """Create all tables defined on the declarative Base.

    Importing the models module ensures every model is registered on the
    Base metadata before create_all runs.
    """
    # Imported here to avoid circular imports and to register model metadata.
    from app import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
