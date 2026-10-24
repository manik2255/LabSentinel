"""LabSentinel FastAPI application entry point.

Sets up the FastAPI app, configures CORS for local development, creates
database tables on startup, and exposes a health check endpoint.
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import create_all_tables


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Application lifespan handler.

    On startup, ensure all database tables exist.
    """
    create_all_tables()
    yield


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


@app.get("/api/health", tags=["health"])
async def health_check() -> dict[str, str]:
    """Simple health check endpoint.

    Returns a static payload indicating the service is running.
    """
    return {"status": "ok", "service": "labsentinel-backend"}
