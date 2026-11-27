from datetime import date, datetime
from io import BytesIO
import re
from typing import Any

import pandas as pd

MONTH_MAP = {
    "jan": "01", "feb": "02", "mar": "03", "apr": "04",
    "may": "05", "jun": "06", "jul": "07", "aug": "08",
    "sep": "09", "oct": "10", "nov": "11", "dec": "12",
}

# Finds things like: Apr'26, Jun 26, Nov-2026, September 2026
MONTH_TEXT_RE = re.compile(r"([A-Za-z]{3,9})[\s'\u2019/\-_.]*(\d{4}|\d{2})(?!\d)")


def _is_blank(v: Any) -> bool:
    if v is None:
        return True
    try:
        return bool(pd.isna(v))
    except (TypeError, ValueError):
        return False


def clean_text(v: Any) -> str:
    """Turn any cell into tidy text. 40001394.0 becomes '40001394'."""
    if _is_blank(v):
        return ""
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return re.sub(r"\s+", " ", str(v)).strip()


def norm_header(v: Any) -> str:
    """'Customer Part No.' -> 'customerpartno' (for forgiving header matching)."""
    return re.sub(r"[^a-z0-9]", "", clean_text(v).lower())


def month_from_text(text: str) -> str | None:
    t = clean_text(text)
    if not t:
        return None
    if re.fullmatch(r"\d{4}-\d{2}(-\d{2})?([ T].*)?", t):
        return t[:7]
    for m in MONTH_TEXT_RE.finditer(t):
        month_num = MONTH_MAP.get(m.group(1)[:3].lower())
        if month_num:
            yr = m.group(2)
            year_str = f"20{yr}" if len(yr) == 2 else yr
            return f"{year_str}-{month_num}"
    return None


def month_from_cell(v: Any) -> str | None:
    if _is_blank(v):
        return None
    if isinstance(v, (datetime, date, pd.Timestamp)):
        return v.strftime("%Y-%m")
    return month_from_text(str(v))


# Kept so other code that imports it still works
def normalize_month_key(col_name: Any) -> str | None:
    return month_from_cell(col_name)


def classify_header(text: str) -> str | None:
    """
    Decide what a month column holds from its header text.
      'Actual customer scheule'  -> schedule    (customer demand)
      "Apr'26 schedule"          -> commit      (IFB commitment)
      'Dispatch QTY'             -> dispatch    (actual dispatch)
    """
    low = clean_text(text).lower()
    if not low:
        return None
    if "dispatch" in low or "despatch" in low or "shipped" in low:
        return "dispatch"
    if "actual" in low or "customer" in low or "demand" in low:
        return "schedule"
    if "commit" in low or "schedule" in low or "plan" in low:
        return "commit"
    return None


def to_number(val: Any) -> int:
    if _is_blank(val):
        return 0
    if isinstance(val, bool):
        return int(val)
    if isinstance(val, (int, float)):
        return int(round(val))
    cleaned = re.sub(r"[^\d.\-]", "", str(val).strip())
    if not cleaned or cleaned in {"-", ".", "-."}:
        return 0
    try:
        return int(round(float(cleaned)))
    except ValueError:
        return 0


def _read_raw(file_bytes: bytes, filename: str) -> pd.DataFrame:
    """Read the whole sheet with no header and no type guessing."""
    if filename.lower().endswith(".csv"):
        return pd.read_csv(
            BytesIO(file_bytes), header=None, dtype=object,
            encoding_errors="replace", skip_blank_lines=False,
        )
    return pd.read_excel(BytesIO(file_bytes), header=None, dtype=object)


def _find_header_row(raw: pd.DataFrame) -> int:
    for idx in range(min(len(raw), 30)):
        row_text = " ".join(clean_text(v).lower() for v in raw.iloc[idx].values if not _is_blank(v))
        if "part" in row_text and ("customer" in row_text or "line" in row_text):
            return idx
    return 0


def parse_schedule_workbook(file_bytes: bytes, filename: str) -> list[dict[str, Any]]:
    raw = _read_raw(file_bytes, filename)
    raw = raw.dropna(how="all").reset_index(drop=True)
    if raw.empty:
        return []

    header_idx = _find_header_row(raw)
    headers = list(raw.iloc[header_idx].values)
    ncols = len(headers)

    # Row just above the headers may hold a month per merged group (e.g. "Apr-2026" over 3 columns)
    group_months: list[str | None] = [None] * ncols
    if header_idx > 0:
        current = None
        for j in range(ncols):
            mk = month_from_cell(raw.iat[header_idx - 1, j])
            if mk:
                current = mk
            group_months[j] = current

    # ---- Info columns -------------------------------------------------
    keys = [norm_header(h) for h in headers]

    def pick(*names: str, contains: tuple[str, ...] = (), exclude: tuple[str, ...] = ()) -> int | None:
        for n in names:
            if n in keys:
                return keys.index(n)
        for j, k in enumerate(keys):
            if not k or any(x in k for x in exclude):
                continue
            if any(c in k for c in contains):
                return j
        return None

    c_sl = pick("slno", "sno", "serialno", "serial", "sl")
    c_cust = pick("customer", "customername", contains=("customername",))
    c_grp = pick("customergroup", "group")
    c_code = pick("customercode", "custcode", contains=("customercode",))
    c_part = pick("partno", "partnumber", "ifbpartno", contains=("partno",), exclude=("customer", "cust"))
    c_cpart = pick("customerpartno", "custpartno", contains=("customerpart", "custpart"))
    c_line = pick("line", "prodline", "productionline")
    c_desc = pick("description", "desc", "productdescription")

    # ---- Month columns ------------------------------------------------
    month_cols: list[tuple[int, str, str]] = []  # (column index, "YYYY-MM", kind)
    for j in range(ncols):
        text = clean_text(headers[j])
        mk = group_months[j] or month_from_text(text)
        if not mk:
            continue
        kind = classify_header(text)
        if kind is None:
            # plain month header like "Nov-26" -> treat as customer schedule
            kind = "schedule" if month_from_text(text) else None
        if kind:
            month_cols.append((j, mk, kind))

    # ---- Rows ---------------------------------------------------------
    def cell(row, j):
        return row[j] if j is not None and j < len(row) else None

    parsed: list[dict[str, Any]] = []
    for r in range(header_idx + 1, len(raw)):
        row = raw.iloc[r].values
        customer = clean_text(cell(row, c_cust))
        part_no = clean_text(cell(row, c_part))
        if not customer and not part_no:
            continue  # blank line or the grand-total row at the bottom
        if customer.lower().startswith("total") or part_no.lower().startswith("total"):
            continue

        schedules: dict[str, int] = {}
        commitments: dict[str, int] = {}
        dispatches: dict[str, int] = {}
        buckets = {"schedule": schedules, "commit": commitments, "dispatch": dispatches}
        for j, mk, kind in month_cols:
            b = buckets[kind]
            b[mk] = b.get(mk, 0) + to_number(row[j])

        # If a sheet has no separate commitment columns, commitment = schedule
        for mk, v in schedules.items():
            commitments.setdefault(mk, v)

        sl = clean_text(cell(row, c_sl)) or str(r - header_idx)
        parsed.append({
            "serial_no": sl,
            "customer": customer,
            "customer_group": clean_text(cell(row, c_grp)) or customer,
            "customer_code": clean_text(cell(row, c_code)),
            "part_no": part_no,
            "customer_part_no": clean_text(cell(row, c_cpart)),
            "line": clean_text(cell(row, c_line)),
            "product_description": clean_text(cell(row, c_desc)),
            "monthly_schedules": schedules,
            "monthly_commitments": commitments,
            "monthly_dispatches": dispatches,
        })

    return parsed