from datetime import datetime, timedelta, timezone
import os
from uuid import uuid4
import bcrypt
import jwt
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.db import get_db
from app.config import settings
from app.models import AuditLog, PortalSession, PortalUser

router = APIRouter(prefix="/api", tags=["auth-audit"])

JWT_SECRET = settings.auth_secret
JWT_ALGORITHM = "HS256"
TOKEN_EXPIRE_HOURS = 12
IDLE_TIMEOUT_MINUTES = 30

class LoginRequest(BaseModel):
    username: str
    password: str


class CreateUserRequest(BaseModel):
    username: str
    password: str
    name: str = ""
    role: str = "planner"


class AuditEventRequest(BaseModel):
    action: str
    summary: str
    category: str = "dashboard"


def hash_password(raw: str) -> str:
    return bcrypt.hashpw(raw.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(raw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(raw.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def create_token(user: PortalUser, session_id: str | None = None) -> str:
    payload = {
        "sub": user.id,
        "username": user.username,
        "role": user.role,
        "sid": session_id,
        "exp": datetime.now(timezone.utc) + timedelta(hours=TOKEN_EXPIRE_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def _extract_sid(authorization: str | None) -> str | None:
    if not authorization or not authorization.startswith("Bearer "):
        return None
    try:
        payload = jwt.decode(authorization.split(" ", 1)[1].strip(), JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload.get("sid")
    except jwt.PyJWTError:
        return None


def _parse_client_info(ua: str) -> str:
    u = (ua or "").lower()
    browser = "Edge" if "edg/" in u else "Chrome" if "chrome/" in u else "Firefox" if "firefox/" in u else "Safari" if "safari/" in u else "Browser"
    os_name = "Windows" if "windows" in u else "macOS" if "mac os" in u else "Android" if "android" in u else "iOS" if ("iphone" in u or "ipad" in u) else "Linux" if "linux" in u else "OS"
    return f"{browser} / {os_name}"


def _sync_timed_out_sessions(db: Session, idle_minutes: int = IDLE_TIMEOUT_MINUTES) -> None:
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=idle_minutes)
    stale = db.query(PortalSession).filter(PortalSession.status == "active").all()
    changed = False
    for s in stale:
        last_ts = s.last_active_at if s.last_active_at.tzinfo else s.last_active_at.replace(tzinfo=timezone.utc)
        if last_ts < cutoff:
            s.status = "timed_out"
            s.ended_at = last_ts + timedelta(minutes=idle_minutes)
            db.add(
                AuditLog(
                    username=s.username,
                    role=s.role,
                    action="IDLE_TIMEOUT",
                    category="session",
                    summary=f"Timed out after {idle_minutes} minutes of inactivity ({s.role})",
                )
            )
            changed = True
    if changed:
        db.commit()


def _touch_session(db: Session, username: str, sid: str | None = None, increment_events: bool = True) -> None:
    q = db.query(PortalSession)
    sess = q.filter(PortalSession.id == sid).first() if sid else (
        q.filter(PortalSession.username == username, PortalSession.status == "active")
        .order_by(PortalSession.signed_in_at.desc())
        .first()
    )
    if sess and sess.status == "active":
        sess.last_active_at = datetime.now(timezone.utc)
        if increment_events:
            sess.events_count = (sess.events_count or 0) + 1
        db.commit()


def _resolve_user_and_session(
    authorization: str | None,
    db: Session,
    enforce_idle: bool = True,
) -> tuple[PortalUser, PortalSession | None]:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid token.")
    token = authorization.split(" ", 1)[1].strip()
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token.")

    user = db.query(PortalUser).filter(PortalUser.id == payload.get("sub")).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found.")

    sid = payload.get("sid")
    sess = db.query(PortalSession).filter(PortalSession.id == sid).first() if sid else None

    if sess and enforce_idle:
        now = datetime.now(timezone.utc)
        if sess.status == "signed_out":
            raise HTTPException(status_code=401, detail="Session has been signed out.")
        if sess.status == "timed_out":
            raise HTTPException(status_code=401, detail="Session timed out due to inactivity.")

        last_ts = sess.last_active_at if sess.last_active_at.tzinfo else sess.last_active_at.replace(tzinfo=timezone.utc)
        if now - last_ts >= timedelta(minutes=IDLE_TIMEOUT_MINUTES):
            sess.status = "timed_out"
            sess.ended_at = now
            db.commit()
            record_audit(
                db,
                user.username,
                user.role,
                "IDLE_TIMEOUT",
                f"Timed out after {IDLE_TIMEOUT_MINUTES} minutes of inactivity ({user.role})",
                "session",
            )
            raise HTTPException(status_code=401, detail="Session timed out due to inactivity.")

        # Refresh last_active_at at most once per minute to avoid SQLite write contention
        if (now - last_ts).total_seconds() >= 60:
            sess.last_active_at = now
            db.commit()

    return user, sess


def get_current_user(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> PortalUser:
    user, _ = _resolve_user_and_session(authorization, db, enforce_idle=True)
    return user

def ensure_default_admin(db: Session):
    admin_user = settings.default_admin_user
    admin_pass = settings.default_admin_pass
    existing = db.query(PortalUser).filter(PortalUser.username == admin_user).first()
    if not existing:
        db.add(
            PortalUser(
                id=uuid4().hex[:12],
                username=admin_user,
                name="Portal Administrator",
                password_hash=hash_password(admin_pass),
                role="admin",
            )
        )
        db.commit()


def record_audit(db: Session, username: str, role: str, action: str, summary: str, category: str = "dashboard"):
    db.add(
        AuditLog(
            username=username,
            role=role,
            action=action,
            category=category,
            summary=summary,
        )
    )
    db.commit()


@router.post("/auth/login")
def login(body: LoginRequest, request: Request, db: Session = Depends(get_db)):
    ensure_default_admin(db)
    user = db.query(PortalUser).filter(PortalUser.username == body.username.strip()).first()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid username or password.")

    _sync_timed_out_sessions(db)
    now = datetime.now(timezone.utc)
    sid = uuid4().hex[:16]
    forwarded = request.headers.get("x-forwarded-for", "")
    client_ip = forwarded.split(",")[0].strip() if forwarded else (request.client.host if request.client else "")
    db.add(
        PortalSession(
            id=sid,
            user_id=user.id,
            username=user.username,
            name=user.name or user.username,
            role=user.role,
            signed_in_at=now,
            last_active_at=now,
            status="active",
            events_count=1,
            client_info=_parse_client_info(request.headers.get("user-agent", "")),
            client_ip=client_ip,
        )
    )
    db.commit()

    record_audit(db, user.username, user.role, "LOGIN", f"Signed in ({user.role})", "session")
    return {
        "token": create_token(user, sid),
        "user": {"id": user.id, "username": user.username, "name": user.name or user.username, "role": user.role},
    }


@router.get("/auth/me")
def me(current_user: PortalUser = Depends(get_current_user)):
    return {
        "user": {
            "id": current_user.id,
            "username": current_user.username,
            "name": current_user.name or current_user.username,
            "role": current_user.role,
        }
    }


@router.get("/users")
def list_users(current_user: PortalUser = Depends(get_current_user), db: Session = Depends(get_db)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin privileges required.")
    users = db.query(PortalUser).order_by(PortalUser.created_at.asc()).all()
    return {
        "users": [
            {"id": u.id, "username": u.username, "name": u.name or u.username, "role": u.role}
            for u in users
        ]
    }


@router.post("/users")
def create_user(
    body: CreateUserRequest,
    current_user: PortalUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin privileges required.")
    uname = body.username.strip()
    if not uname or len(body.password) < 6:
        raise HTTPException(status_code=400, detail="Username required; password must be at least 6 characters.")
    if db.query(PortalUser).filter(PortalUser.username == uname).first():
        raise HTTPException(status_code=409, detail="Username already exists.")

    role = body.role if body.role in {"admin", "planner"} else "planner"
    new_u = PortalUser(
        id=uuid4().hex[:12],
        username=uname,
        name=body.name.strip() or uname,
        password_hash=hash_password(body.password),
        role=role,
    )
    db.add(new_u)
    db.commit()
    record_audit(db, current_user.username, current_user.role, "USER_CREATE", f"Created user {uname} ({role})", "admin")
    return {"user": {"id": new_u.id, "username": new_u.username, "name": new_u.name, "role": new_u.role}}

@router.delete("/users/{user_id}")
def delete_user(
    user_id: str,
    current_user: PortalUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin privileges required.")
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot delete your own active account.")
    target = db.query(PortalUser).filter(PortalUser.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found.")
    db.delete(target)
    db.commit()
    record_audit(db, current_user.username, current_user.role, "USER_DELETE", f"Removed user {target.username}", "admin")
    return {"status": "deleted", "deletedUserId": user_id}


@router.post("/auth/ping")
def ping_session(current_user: PortalUser = Depends(get_current_user)):
    return {"status": "ok", "username": current_user.username}


@router.post("/auth/logout")
def logout(
    reason: str = "manual",
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    user, sess = _resolve_user_and_session(authorization, db, enforce_idle=False)
    now = datetime.now(timezone.utc)

    if not sess:
        sess = (
            db.query(PortalSession)
            .filter(PortalSession.username == user.username, PortalSession.status == "active")
            .order_by(PortalSession.signed_in_at.desc())
            .first()
        )

    if reason == "timeout":
        already_timed_out = sess is not None and sess.status == "timed_out"
        if sess and sess.status == "active":
            sess.status = "timed_out"
            sess.last_active_at = now
            sess.ended_at = now
            sess.events_count = (sess.events_count or 0) + 1
            db.commit()
        if not already_timed_out:
            record_audit(
                db,
                user.username,
                user.role,
                "IDLE_TIMEOUT",
                f"Timed out after {IDLE_TIMEOUT_MINUTES} minutes of inactivity ({user.role})",
                "session",
            )
    else:
        if sess and sess.status == "active":
            sess.status = "signed_out"
            sess.last_active_at = now
            sess.ended_at = now
            sess.events_count = (sess.events_count or 0) + 1
            db.commit()
        record_audit(db, user.username, user.role, "LOGOUT", f"Signed out ({user.role})", "session")

    return {"status": "ok"}


@router.post("/audit/event")
def post_audit_event(
    body: AuditEventRequest,
    authorization: str | None = Header(default=None),
    current_user: PortalUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    record_audit(db, current_user.username, current_user.role, body.action, body.summary, body.category)
    _touch_session(db, current_user.username, _extract_sid(authorization), increment_events=True)
    return {"status": "ok"}


@router.get("/audit/logs")
def get_audit_logs(
    limit: int = 100,
    current_user: PortalUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin privileges required.")
    logs = db.query(AuditLog).order_by(AuditLog.created_at.desc()).limit(min(limit, 500)).all()
    return {
        "logs": [
            {
                "id": l.id,
                "username": l.username,
                "role": l.role,
                "action": l.action,
                "category": l.category,
                "summary": l.summary,
                "at": (l.created_at if l.created_at.tzinfo else l.created_at.replace(tzinfo=timezone.utc)).isoformat() if l.created_at else "",
            }
            for l in logs
        ]
    }
@router.get("/audit/sessions")
def get_audit_sessions(
    limit: int = 100,
    current_user: PortalUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin privileges required.")
    _sync_timed_out_sessions(db)
    sessions = db.query(PortalSession).order_by(PortalSession.signed_in_at.desc()).limit(min(limit, 200)).all()

    def _iso(dt):
        if not dt:
            return ""
        return (dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)).isoformat()

    active_count = sum(1 for s in sessions if s.status == "active")
    return {
        "activeCount": active_count,
        "sessions": [
            {
                "id": s.id,
                "username": s.username,
                "name": s.name or s.username,
                "role": s.role,
                "signedInAt": _iso(s.signed_in_at),
                "lastActiveAt": _iso(s.ended_at or s.last_active_at),
                "status": s.status,
                "eventsCount": s.events_count or 0,
                "clientInfo": s.client_info or "Browser / OS",
                "clientIp": s.client_ip or "",
            }
            for s in sessions
        ],
    }