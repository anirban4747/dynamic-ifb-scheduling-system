from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session
from app.config import settings
from app.db import get_db
from app.models import PortalUser, ScheduleRow, ScheduleSnapshot
from app.routers.auth_audit import get_current_user, record_audit
from app.services.excel_parser import parse_schedule_workbook

router = APIRouter(prefix="/api/schedules", tags=["schedules"], dependencies=[Depends(get_current_user)])


@router.post("/upload")
async def upload_schedule_file(
    file: UploadFile = File(...),
    snapshot_date: str | None = Form(default=None),
    current_user: PortalUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    filename = file.filename or "schedule.xlsx"
    if not filename.lower().endswith((".xlsx", ".xls", ".csv")):
        raise HTTPException(status_code=400, detail="Only .xlsx, .xls, or .csv files are supported.")

    content = await file.read()
    parsed = parse_schedule_workbook(content, filename)
    if not parsed:
        raise HTTPException(status_code=400, detail="No valid schedule rows found in workbook.")

    uploads_path = Path(settings.uploads_dir)
    uploads_path.mkdir(parents=True, exist_ok=True)
    snapshot_id = uuid4().hex[:12]
    safe_name = f"{snapshot_id}_{Path(filename).name}"
    (uploads_path / safe_name).write_bytes(content)

    snap_date = (snapshot_date or "").strip() or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    snapshot = ScheduleSnapshot(
        id=snapshot_id,
        filename=filename,
        source_name=filename,
        snapshot_date=snap_date,
        row_count=len(parsed),
    )
    db.add(snapshot)

    for item in parsed:
        db.add(
            ScheduleRow(
                snapshot_id=snapshot_id,
                serial_no=item["serial_no"],
                customer=item["customer"],
                customer_group=item["customer_group"],
                customer_code=item["customer_code"],
                part_no=item["part_no"],
                customer_part_no=item["customer_part_no"],
                line=item["line"],
                product_description=item["product_description"],
                monthly_schedules=item["monthly_schedules"],
                monthly_commitments=item["monthly_commitments"],
                monthly_dispatches=item["monthly_dispatches"],
            )
        )

    db.commit()
    record_audit(db, current_user.username, current_user.role, "SCHEDULE_UPLOAD", f"Uploaded {filename} ({len(parsed)} rows)", "change")
    return {
        "status": "ok",
        "snapshotId": snapshot_id,
        "filename": filename,
        "snapshotDate": snap_date,
        "rowCount": len(parsed),
    }


@router.get("/snapshots")
def list_snapshots(db: Session = Depends(get_db)):
    snaps = db.query(ScheduleSnapshot).order_by(ScheduleSnapshot.uploaded_at.desc()).all()
    return [
        {
            "snapshotId": s.id,
            "filename": s.filename,
            "source": s.source_name,
            "snapshotDate": s.snapshot_date,
            "uploadedAt": (s.uploaded_at if s.uploaded_at.tzinfo else s.uploaded_at.replace(tzinfo=timezone.utc)).isoformat() if s.uploaded_at else "",
            "rowCount": s.row_count,
        }
        for s in snaps
    ]


@router.get("/rows")
def get_schedule_rows(snapshotId: str | None = None, db: Session = Depends(get_db)):
    query = db.query(ScheduleRow)
    if snapshotId and snapshotId != "__ALL__":
        query = query.filter(ScheduleRow.snapshot_id == snapshotId)
    else:
        latest = db.query(ScheduleSnapshot).order_by(ScheduleSnapshot.uploaded_at.desc()).first()
        if latest:
            query = query.filter(ScheduleRow.snapshot_id == latest.id)
    rows = query.order_by(ScheduleRow.id.asc()).all()
    return {
        "count": len(rows),
        "rows": [
            {
                "id": r.id,
                "snapshotId": r.snapshot_id,
                "serialNo": r.serial_no or "",
                "customer": r.customer or "",
                "customerGroup": r.customer_group or r.customer or "",
                "customerCode": r.customer_code or "",
                "partNo": r.part_no or "",
                "helper": f"{r.customer_code or ''}{r.part_no or ''}",
                "customerPartNo": r.customer_part_no or "",
                "line": r.line or "",
                "productDescription": r.product_description or "",
                "monthlySchedules": r.monthly_schedules or {},
                "monthlyCommitments": r.monthly_commitments or {},
                "monthlyDispatches": r.monthly_dispatches or {},
            }
            for r in rows
        ],
    }

def _shift_ym(ym: str, offset: int) -> str:
    year, month = map(int, ym.split("-"))
    total_months = year * 12 + (month - 1) + offset
    new_year = total_months // 12
    new_month = (total_months % 12) + 1
    return f"{new_year:04d}-{new_month:02d}"


def _format_ym(ym: str) -> str:
    months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    year, month = map(int, ym.split("-"))
    return f"{months[month - 1]}-{str(year)[-2:]}"


@router.delete("/snapshots/{snapshot_id}")
def delete_snapshot(snapshot_id: str, db: Session = Depends(get_db), current_user: PortalUser = Depends(get_current_user)):
    snap = db.query(ScheduleSnapshot).filter(ScheduleSnapshot.id == snapshot_id).first()
    if not snap:
        raise HTTPException(status_code=404, detail="Snapshot not found.")
    fname = snap.filename
    db.delete(snap)
    db.commit()
    for f in Path(settings.uploads_dir).glob(f"{snapshot_id}_*"):
        f.unlink(missing_ok=True)
    record_audit(db, current_user.username, current_user.role, "SCHEDULE_DELETE", f"Deleted {fname}", "change")
    return {"status": "deleted", "snapshotId": snapshot_id}

@router.get("/snapshots/{snapshot_id}/download")
def download_snapshot(snapshot_id: str, db: Session = Depends(get_db)):
    snap = db.query(ScheduleSnapshot).filter(ScheduleSnapshot.id == snapshot_id).first()
    if not snap:
        raise HTTPException(status_code=404, detail="Snapshot not found.")
    uploads_path = Path(settings.uploads_dir)
    matching = list(uploads_path.glob(f"{snapshot_id}_*"))
    if not matching:
        raise HTTPException(status_code=404, detail="Uploaded file not found on disk.")
    from fastapi.responses import FileResponse
    return FileResponse(path=matching[0], filename=snap.filename, media_type="application/octet-stream")


@router.delete("/rows/{row_id}")
def delete_schedule_row(
    row_id: int,
    current_user: PortalUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = db.query(ScheduleRow).filter(ScheduleRow.id == row_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Schedule row not found.")
    snap = db.query(ScheduleSnapshot).filter(ScheduleSnapshot.id == row.snapshot_id).first()
    if snap and snap.row_count > 0:
        snap.row_count -= 1
    part_label = f"{row.customer} / {row.part_no}".strip(" /")
    db.delete(row)
    db.commit()
    record_audit(db, current_user.username, current_user.role, "ROW_DELETE", f"Deleted schedule row {part_label}", "change")
    return {"status": "deleted", "id": row_id}

def _to_int(v) -> int:
    try:
        f = float(str(v).replace(",", "").strip())
        return 0 if f != f else int(f)
    except (TypeError, ValueError, OverflowError):
        return 0

@router.get("/analytics")
def get_schedule_analytics(
    snapshotId: str = "__ALL__",
    customer: str = "ALL",
    month: str | None = None,
    target: float = 80.0,
    db: Session = Depends(get_db),
):
    query = db.query(ScheduleRow)
    if snapshotId and snapshotId != "__ALL__":
        query = query.filter(ScheduleRow.snapshot_id == snapshotId)
    else:
        latest = db.query(ScheduleSnapshot).order_by(ScheduleSnapshot.uploaded_at.desc()).first()
        if latest:
            query = query.filter(ScheduleRow.snapshot_id == latest.id)
    all_rows = query.all()

    def cust_name(r: ScheduleRow) -> str:
        return (r.customer_group or r.customer or "Unknown").strip()

    month_set: set[str] = set()
    for r in all_rows:
        for m in (r.monthly_schedules or {}).keys():
            month_set.add(m)
        for m in (r.monthly_commitments or {}).keys():
            month_set.add(m)
        for m in (r.monthly_dispatches or {}).keys():
            month_set.add(m)

    available_months = sorted(month_set)
    current_ym = datetime.now(timezone.utc).strftime("%Y-%m")
    default_month = current_ym if current_ym in available_months else (available_months[-1] if available_months else current_ym)
    selected_month = month if month in available_months else default_month

    prev_month = _shift_ym(selected_month, -1)
    next_month = _shift_ym(selected_month, 1)
    next2_month = _shift_ym(selected_month, 2)
    customers_in_scope = sorted({cust_name(r) for r in all_rows if cust_name(r)})
    scoped_rows = (
        all_rows
        if not customer or customer == "ALL"
        else [r for r in all_rows if cust_name(r) == customer]
    )

    trend_months = available_months
    monthly_trend = []
    for m in trend_months:
        demand = 0
        commitment = 0
        dispatched = 0
        has_data = False
        for r in scoped_rows:
            sched_map = r.monthly_schedules or {}
            commit_map = r.monthly_commitments or {}
            disp_map = r.monthly_dispatches or {}
            d_val = _to_int(sched_map.get(m))
            c_val = _to_int(commit_map[m]) if m in commit_map else d_val
            p_val = _to_int(disp_map.get(m))
            if d_val or c_val or p_val:
                has_data = True
            demand += d_val
            commitment += c_val
            dispatched += p_val
        fill_rate = round((dispatched / commitment) * 100, 1) if commitment > 0 else None
        monthly_trend.append({
            "month": m,
            "label": _format_ym(m),
            "demand": demand,
            "commitment": commitment,
            "dispatched": dispatched,
            "fillRate": fill_rate,
            "hasData": has_data,
        })

    total_commitment = 0
    total_dispatched = 0
    total_demand = 0
    gross_shortfall = 0
    gross_surplus = 0
    parts_shortfall = 0
    parts_on_target = 0
    parts_scheduled = 0

    part_agg: dict[str, dict] = {}
    cust_agg: dict[str, dict] = {}

    for r in scoped_rows:
        d_qty = _to_int((r.monthly_schedules or {}).get(selected_month))
        c_qty = _to_int((r.monthly_commitments or {})[selected_month]) if selected_month in (r.monthly_commitments or {}) else d_qty
        p_qty = _to_int((r.monthly_dispatches or {}).get(selected_month))
        diff = p_qty - c_qty
        cname = cust_name(r)

        total_demand += d_qty
        total_commitment += c_qty
        total_dispatched += p_qty

        if c_qty > 0:
            parts_scheduled += 1
            rate = (p_qty / c_qty) * 100
            if rate >= target:
                parts_on_target += 1
            if diff < 0:
                gross_shortfall += abs(diff)
                parts_shortfall += 1
            elif diff > 0:
                gross_surplus += diff

        pkey = f"{cname}||{r.part_no or '-'}"
        if pkey not in part_agg:
            part_agg[pkey] = {
                "partNo": r.part_no or "-",
                "customer": cname,
                "line": r.line or "-",
                "prevDemand": 0,
                "next1Demand": 0,
                "next2Demand": 0,
                "demand": 0,
                "commitment": 0,
                "dispatched": 0,
            }
        part_agg[pkey]["demand"] += d_qty
        part_agg[pkey]["commitment"] += c_qty
        part_agg[pkey]["dispatched"] += p_qty
        part_agg[pkey]["prevDemand"] += _to_int((r.monthly_schedules or {}).get(prev_month))
        part_agg[pkey]["next1Demand"] += _to_int((r.monthly_schedules or {}).get(next_month))
        part_agg[pkey]["next2Demand"] += _to_int((r.monthly_schedules or {}).get(next2_month))

        if cname not in cust_agg:
            cust_agg[cname] = {"customer": cname, "commitment": 0, "dispatched": 0}
        cust_agg[cname]["commitment"] += c_qty
        cust_agg[cname]["dispatched"] += p_qty

    part_rows = []
    for item in part_agg.values():
        diff = item["dispatched"] - item["commitment"]
        ach = round((item["dispatched"] / item["commitment"]) * 100, 1) if item["commitment"] > 0 else None
        part_rows.append({
            **item,
            "diff": diff,
            "achievementRate": ach,
        })

    by_customer = []
    for c_item in cust_agg.values():
        rate = round((c_item["dispatched"] / c_item["commitment"]) * 100, 1) if c_item["commitment"] > 0 else None
        by_customer.append({
            **c_item,
            "fillRate": rate,
        })

    fulfillment_rate = round((total_dispatched / total_commitment) * 100, 1) if total_commitment > 0 else None

    return {
        "selectedMonth": selected_month,
        "selectedMonthLabel": _format_ym(selected_month) if available_months else selected_month,
        "availableMonths": available_months,
        "customers": customers_in_scope,
        "targetPercent": target,
        "summary": {
            "totalDemand": total_demand,
            "totalCommitment": total_commitment,
            "totalDispatched": total_dispatched,
            "fulfillmentRate": fulfillment_rate,
            "grossShortfall": gross_shortfall,
            "grossSurplus": gross_surplus,
            "partsShortfall": parts_shortfall,
            "partsOnTarget": parts_on_target,
            "partsScheduled": parts_scheduled,
        },
        "monthlyTrend": monthly_trend,
        "partRows": part_rows,
        "byCustomer": by_customer,
    }