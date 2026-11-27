from datetime import datetime, timezone
from sqlalchemy import Column, DateTime, ForeignKey, Integer, JSON, String, Text, Boolean, Float
from sqlalchemy.orm import relationship
from app.db import Base


def utc_now():
    return datetime.now(timezone.utc)


class ScheduleSnapshot(Base):
    __tablename__ = "schedule_snapshots"

    id = Column(String(64), primary_key=True, index=True)
    filename = Column(String(255), nullable=False)
    source_name = Column(String(255), nullable=False)
    snapshot_date = Column(String(32), nullable=False, index=True)
    uploaded_at = Column(DateTime(timezone=True), default=utc_now, nullable=False)
    row_count = Column(Integer, default=0, nullable=False)

    rows = relationship("ScheduleRow", back_populates="snapshot", cascade="all, delete-orphan")


class ScheduleRow(Base):
    __tablename__ = "schedule_rows"

    id = Column(Integer, primary_key=True, autoincrement=True)
    snapshot_id = Column(String(64), ForeignKey("schedule_snapshots.id", ondelete="CASCADE"), index=True, nullable=False)
    serial_no = Column(String(64), default="")
    customer = Column(String(255), index=True, default="")
    customer_group = Column(String(255), index=True, default="")
    customer_code = Column(String(128), default="")
    part_no = Column(String(128), index=True, default="")
    customer_part_no = Column(String(128), default="")
    line = Column(String(128), index=True, default="")
    product_description = Column(Text, default="")
    delivery_month = Column(String(64), default="")
    monthly_schedules = Column(JSON, default=dict)
    monthly_commitments = Column(JSON, default=dict)
    monthly_dispatches = Column(JSON, default=dict)
    current_month_qty = Column(Integer, default=0)
    actual_dispatch_qty = Column(Integer, default=0)
    extra_fields = Column(JSON, default=dict)

    snapshot = relationship("ScheduleSnapshot", back_populates="rows")
class PortalUser(Base):
    __tablename__ = "portal_users"

    id = Column(String(64), primary_key=True, index=True)
    username = Column(String(120), unique=True, index=True, nullable=False)
    name = Column(String(200), default="")
    password_hash = Column(String(255), nullable=False)
    role = Column(String(32), default="planner", nullable=False)  # "admin" | "planner"
    created_at = Column(DateTime(timezone=True), default=utc_now, nullable=False)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(String(120), index=True, nullable=False)
    role = Column(String(32), default="planner", nullable=False)
    action = Column(String(80), index=True, nullable=False)
    category = Column(String(40), default="dashboard", nullable=False)
    summary = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utc_now, nullable=False)

class PortalSession(Base):
    __tablename__ = "portal_sessions"

    id = Column(String(64), primary_key=True, index=True)
    user_id = Column(String(64), index=True, nullable=False)
    username = Column(String(120), index=True, nullable=False)
    name = Column(String(200), default="")
    role = Column(String(32), default="planner", nullable=False)
    signed_in_at = Column(DateTime(timezone=True), default=utc_now, nullable=False)
    last_active_at = Column(DateTime(timezone=True), default=utc_now, nullable=False)
    ended_at = Column(DateTime(timezone=True), nullable=True)
    status = Column(String(32), default="active", nullable=False)  # "active" | "signed_out" | "timed_out"
    events_count = Column(Integer, default=1, nullable=False)
    client_info = Column(String(120), default="Unknown")
    client_ip = Column(String(64), default="")