from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.db import Base, engine
from app import models  # noqa: F401
from app.models import AuditLog, PortalUser, ScheduleRow, ScheduleSnapshot
from app.routers import auth_audit, schedules

Base.metadata.create_all(bind=engine)

app = FastAPI(
    title=settings.app_name,
    version="2.0.0",
)

allowed_origins = [
    origin.strip()
    for origin in settings.cors_origins.split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(schedules.router)
app.include_router(auth_audit.router)


@app.get("/health")
def health_check():
    return {"status": "ok", "service": "ifb-scheduling-api"}
