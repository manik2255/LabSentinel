"""LabSentinel FastAPI application entry point.

Sets up the FastAPI app, configures CORS for local development, creates
database tables on startup, and exposes a health check endpoint.
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.crud.exceptions import DomainError
from app.database import create_all_tables
from app.detection import detector
from app.routers import detection as detection_router
from app.routers import equipment as equipment_router
from app.routers import incident as incident_router
from app.routers import rescue as rescue_router
from app.routers import sample as sample_router
from app.routers import simulation as simulation_router
from app.simulation import simulator


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Application lifespan handler.

    On startup, ensure all database tables exist and that the anomaly
    detection model is loaded (or freshly trained). On shutdown, stop the
    temperature simulator if it is running so no background thread is left
    behind.
    """
    create_all_tables()
    # Load a persisted model or train and save one, so detection is always
    # ready. Best-effort: a failure here must not block app startup.
    try:
        detector.ensure_ready()
    except Exception:  # noqa: BLE001
        pass
    try:
        yield
    finally:
        simulator.stop()


app = FastAPI(
    title="LabSentinel API",
    description=(
        "Backend for the LabSentinel laboratory equipment monitoring and "
        "emergency sample rescue planning system."
    ),
    version="0.1.0",
    lifespan=lifespan,
)

# CORS configuration for local development front-ends.
# Allowing common localhost origins used by dev servers (Vite, CRA, etc.).
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:5173",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(DomainError)
async def domain_error_handler(_request: Request, exc: DomainError) -> JSONResponse:
    """Translate domain/business-rule errors into HTTP responses."""
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.message},
    )


# Feature routers
app.include_router(equipment_router.router)
app.include_router(sample_router.router)
app.include_router(simulation_router.router)
app.include_router(detection_router.router)
app.include_router(rescue_router.router)
app.include_router(incident_router.router)


@app.get("/api/health", tags=["health"])
async def health_check() -> dict[str, str]:
    """Simple health check endpoint.

    Returns a static payload indicating the service is running.
    """
    return {"status": "ok", "service": "labsentinel-backend"}
