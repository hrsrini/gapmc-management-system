"""
Build EMP-ID remap preview workbook and optionally apply remaps from the board Excel.

Usage (from repo root):
  python scripts/remap-employee-ids-from-xlsx.py
  python scripts/remap-employee-ids-from-xlsx.py --apply

Default mapping file:
  C:\\Users\\Rajendra\\Downloads\\employee ID nos..xlsx

Preview output:
  docs/employee-id-remap-preview.xlsx
"""
from __future__ import annotations

import argparse
import os
import re
import sys
import unicodedata
from pathlib import Path

from dotenv import load_dotenv
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font, PatternFill

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MAP = Path(r"c:\Users\Rajendra\Downloads\employee ID nos..xlsx")
OUT_XLSX = ROOT / "docs" / "employee-id-remap-preview.xlsx"

FILL_MISMATCH = PatternFill("solid", fgColor="FFC7CE")
FILL_FUZZY = PatternFill("solid", fgColor="FFEB9C")
FILL_OK = PatternFill("solid", fgColor="C6EFCE")
FILL_HEADER = PatternFill("solid", fgColor="D9E1F2")
FONT_BOLD = Font(bold=True)


def pad4(emp: str) -> str:
    m = re.match(r"^EMP-(\d+)$", str(emp).strip().upper())
    if not m:
        return str(emp).strip().upper()
    return f"EMP-{int(m.group(1)):04d}"


def norm_name(s: str | None) -> str:
    if s is None:
        return ""
    t = unicodedata.normalize("NFKC", str(s))
    t = t.replace(".", " ").replace(",", " ")
    t = re.sub(r"\b(shri|smt|mrs|miss|ms|mr|kumari)\b\.?", " ", t, flags=re.I)
    return re.sub(r"\s+", " ", t).strip().lower()


def tokens(s: str | None) -> set[str]:
    return set(norm_name(s).split()) if s else set()


def name_match(xlsx_name: str, first: str, middle: str, surname: str) -> str:
    db = " ".join(x for x in [first or "", middle or "", surname or ""] if str(x).strip())
    xn, dn = norm_name(xlsx_name), norm_name(db)
    if not xn or not dn:
        return "EMPTY"
    if xn == dn:
        return "EXACT"
    xt, dt = tokens(xlsx_name), tokens(db)
    if xt <= dt or dt <= xt:
        return "PARTIAL"
    inter = len(xt & dt)
    union = len(xt | dt) or 1
    if inter / union >= 0.6:
        return "FUZZY"
    return "MISMATCH"


def db_display_name(first: str, middle: str, surname: str) -> str:
    return " ".join(x for x in [first or "", middle or "", surname or ""] if str(x).strip())


def load_mapping(path: Path) -> list[tuple[str, str, str]]:
    wb = load_workbook(path, read_only=True, data_only=True)
    rows = list(wb.active.iter_rows(values_only=True))[1:]
    out: list[tuple[str, str, str]] = []
    for r in rows:
        if not r or not r[0]:
            continue
        sys_id = str(r[0]).strip().upper()
        act_id = pad4(str(r[1]).strip().upper())
        name = str(r[2] or "").strip()
        out.append((sys_id, act_id, name))
    return out


def fetch_employees(conn):
    cur = conn.cursor()
    cur.execute(
        """
        SELECT id, emp_id, first_name, COALESCE(middle_name,''), surname, status
        FROM gapmc.employees
        ORDER BY
          CASE WHEN emp_id ~* '^EMP-[0-9]+$' THEN 0 ELSE 1 END,
          CASE WHEN emp_id ~* '^EMP-[0-9]+$' THEN CAST(substring(emp_id from '[0-9]+') AS int) ELSE 0 END,
          emp_id NULLS LAST, surname, first_name
        """
    )
    rows = cur.fetchall()
    cur.close()
    by_emp: dict[str, dict] = {}
    for id_, emp_id, first, middle, surname, status in rows:
        key = (emp_id or "").strip().upper()
        by_emp[key] = {
            "id": id_,
            "emp_id": emp_id,
            "first": first,
            "middle": middle,
            "surname": surname,
            "status": status,
            "db_name": db_display_name(first, middle, surname),
        }
    return rows, by_emp


def style_header(ws, cols: int) -> None:
    for c in range(1, cols + 1):
        cell = ws.cell(1, c)
        cell.fill = FILL_HEADER
        cell.font = FONT_BOLD


def write_preview(path: Path, db_rows, by_emp, mapping) -> dict:
    wb = Workbook()

    # Sheet 1: current
    ws1 = wb.active
    ws1.title = "Current_DB"
    ws1.append(["Emp ID", "Name", "Status", "Internal ID"])
    style_header(ws1, 4)
    for id_, emp_id, first, middle, surname, status in db_rows:
        ws1.append([emp_id or "", db_display_name(first, middle, surname), status, id_])

    # Sheet 2: planned updates
    ws2 = wb.create_sheet("Planned_Updates")
    ws2.append(
        [
            "System Generated Employee ID",
            "Actual Employee ID",
            "Name (Excel)",
            "Name (DB)",
            "Status",
            "Name check",
            "Action",
        ]
    )
    style_header(ws2, 7)

    planned = []
    mismatches = []
    missing = []
    for sys_id, act_id, xname in mapping:
        row = by_emp.get(sys_id)
        if not row:
            missing.append((sys_id, act_id, xname))
            ws2.append([sys_id, act_id, xname, "", "", "NOT_IN_DB", "SKIP — system EMP-ID not found"])
            ws2.cell(ws2.max_row, 6).fill = FILL_MISMATCH
            continue
        mm = name_match(xname, row["first"], row["middle"], row["surname"])
        action = f"UPDATE {sys_id} → {act_id}"
        planned.append((sys_id, act_id, xname, row, mm))
        ws2.append([sys_id, act_id, xname, row["db_name"], row["status"], mm, action])
        fill = FILL_OK if mm in ("EXACT", "PARTIAL") else FILL_FUZZY if mm == "FUZZY" else FILL_MISMATCH
        ws2.cell(ws2.max_row, 6).fill = fill
        if mm == "MISMATCH":
            mismatches.append((sys_id, act_id, xname, row["db_name"]))

    # Sheet 3: not in file
    ws3 = wb.create_sheet("Not_In_Excel")
    ws3.append(["Emp ID", "Name", "Status", "Internal ID", "Notes"])
    style_header(ws3, 5)
    xlsx_sys = {s for s, _, __ in mapping}
    not_in_file = []
    for key, row in by_emp.items():
        if key in xlsx_sys:
            continue
        not_in_file.append(row)
        note = "Decide: keep / remap / deactivate"
        if key.startswith("AUTO-") or key == "":
            note = "Non-standard / no EMP — leave unless instructed"
        elif re.match(r"^EMP-00[1-9]$", key or "", re.I):
            note = "Looks like yard/location placeholder — decide"
        elif key == "EMP-010":
            note = "Real employee — needs board Actual ID from you"
        ws3.append([row["emp_id"] or "", row["db_name"], row["status"], row["id"], note])

    # Sheet 4: mismatches only
    ws4 = wb.create_sheet("Name_Mismatches")
    ws4.append(["System ID", "Actual ID", "Excel Name", "DB Name", "Note"])
    style_header(ws4, 5)
    for sys_id, act_id, xname, dbname in mismatches:
        ws4.append([sys_id, act_id, xname, dbname, "Confirm same person before/after remap"])
        for c in range(1, 6):
            ws4.cell(ws4.max_row, c).fill = FILL_MISMATCH

    # Sheet 5: summary
    ws5 = wb.create_sheet("Summary")
    max_n = 0
    for _, act, __ in mapping:
        m = re.match(r"^EMP-(\d+)$", act, re.I)
        if m:
            max_n = max(max_n, int(m.group(1)))
    for row in not_in_file:
        m = re.match(r"^EMP-(\d+)$", row["emp_id"] or "", re.I)
        if m:
            max_n = max(max_n, int(m.group(1)))
    next_id = f"EMP-{max_n + 1:04d}" if max_n else ""
    ws5.append(["Metric", "Value"])
    style_header(ws5, 2)
    ws5.append(["DB employees", len(db_rows)])
    ws5.append(["Excel mappings", len(mapping)])
    ws5.append(["Planned remaps", len(planned)])
    ws5.append(["Excel IDs missing in DB", len(missing)])
    ws5.append(["Name mismatches", len(mismatches)])
    ws5.append(["In DB but not in Excel", len(not_in_file)])
    ws5.append(["Max EMP number after remap (incl. leftovers)", max_n])
    ws5.append(["Next new EMP-ID (4-digit)", next_id])
    ws5.append(["Not remapped (left unchanged)", ", ".join((r["emp_id"] or "(blank)") for r in not_in_file)])

    path.parent.mkdir(parents=True, exist_ok=True)
    wb.save(path)
    return {
        "planned": planned,
        "mismatches": mismatches,
        "missing": missing,
        "not_in_file": not_in_file,
        "next_id": next_id,
        "max_n": max_n,
    }


def apply_remap(conn, planned: list) -> None:
    """Two-phase rename to avoid unique emp_id collisions."""
    cur = conn.cursor()
    # Phase 1: to temp
    for i, (sys_id, act_id, xname, row, mm) in enumerate(planned):
        temp = f"TMP-MIG-{i:04d}"
        cur.execute(
            "UPDATE gapmc.employees SET emp_id = %s, updated_at = NOW() WHERE id = %s AND emp_id = %s",
            (temp, row["id"], sys_id),
        )
        if cur.rowcount != 1:
            raise RuntimeError(f"Phase1 failed for {sys_id} (id={row['id']})")
    # Phase 2: to final
    for i, (sys_id, act_id, xname, row, mm) in enumerate(planned):
        temp = f"TMP-MIG-{i:04d}"
        cur.execute(
            "UPDATE gapmc.employees SET emp_id = %s, updated_at = NOW() WHERE id = %s AND emp_id = %s",
            (act_id, row["id"], temp),
        )
        if cur.rowcount != 1:
            raise RuntimeError(f"Phase2 failed for {sys_id} → {act_id}")
    conn.commit()
    cur.close()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--map", type=Path, default=DEFAULT_MAP)
    parser.add_argument("--out", type=Path, default=OUT_XLSX)
    parser.add_argument("--apply", action="store_true", help="Apply remaps to database")
    args = parser.parse_args()

    load_dotenv(ROOT / ".env")
    url = os.environ.get("DATABASE_URL", "").strip()
    if not url:
        print("DATABASE_URL required", file=sys.stderr)
        return 1
    if not args.map.exists():
        print(f"Mapping file not found: {args.map}", file=sys.stderr)
        return 1

    import psycopg2

    mapping = load_mapping(args.map)
    conn = psycopg2.connect(url)
    try:
        db_rows, by_emp = fetch_employees(conn)
        summary = write_preview(args.out, db_rows, by_emp, mapping)
        print(f"Wrote preview: {args.out}")
        print(
            f"planned={len(summary['planned'])} mismatches={len(summary['mismatches'])} "
            f"not_in_excel={len(summary['not_in_file'])} next={summary['next_id']}"
        )
        for sys_id, act_id, xname, dbname in summary["mismatches"]:
            print(f"NAME MISMATCH: {sys_id} excel={xname!r} db={dbname!r} -> still remapping to {act_id}")

        if args.apply:
            if summary["missing"]:
                print("Abort: Excel IDs missing in DB:", summary["missing"], file=sys.stderr)
                return 1
            apply_remap(conn, summary["planned"])
            print(f"Applied {len(summary['planned'])} remaps.")
            # verify
            db_rows2, by_emp2 = fetch_employees(conn)
            ok = 0
            for sys_id, act_id, xname, row, mm in summary["planned"]:
                found = by_emp2.get(act_id)
                if found and found["id"] == row["id"]:
                    ok += 1
                else:
                    print(f"VERIFY FAIL: {sys_id} -> {act_id}")
            print(f"Verified {ok}/{len(summary['planned'])}")
            # rewrite preview after apply - mapping still lists old system IDs;
            # rebuild "current" sheet from DB (actual IDs now).
            write_preview_after_apply(args.out, db_rows2, by_emp2, summary["planned"], summary["not_in_file"], summary["next_id"])
            print(f"Updated preview after apply: {args.out}")
        else:
            print("Dry-run only. Re-run with --apply to update the database.")
    finally:
        conn.close()
    return 0


def write_preview_after_apply(path: Path, db_rows, by_emp, planned, not_in_file, next_id) -> None:
    """Rewrite workbook reflecting post-apply state (current IDs are actuals)."""
    wb = Workbook()
    ws1 = wb.active
    ws1.title = "Current_DB"
    ws1.append(["Emp ID", "Name", "Status", "Internal ID"])
    style_header(ws1, 4)
    for id_, emp_id, first, middle, surname, status in db_rows:
        ws1.append([emp_id or "", db_display_name(first, middle, surname), status, id_])

    ws2 = wb.create_sheet("Applied_Updates")
    ws2.append(["Old System ID", "New Actual ID", "Excel Name", "DB Name", "Name check"])
    style_header(ws2, 5)
    for sys_id, act_id, xname, row, mm in planned:
        ws2.append([sys_id, act_id, xname, row["db_name"], mm])
        fill = FILL_OK if mm in ("EXACT", "PARTIAL") else FILL_FUZZY if mm == "FUZZY" else FILL_MISMATCH
        ws2.cell(ws2.max_row, 5).fill = fill

    ws3 = wb.create_sheet("Not_In_Excel_Unchanged")
    ws3.append(["Emp ID", "Name", "Status", "Internal ID"])
    style_header(ws3, 4)
    for row in not_in_file:
        # refresh from by_emp by id
        cur = by_emp.get((row["emp_id"] or "").strip().upper()) or row
        # after apply, not_in_file still has old emp_ids for those rows
        ws3.append([cur.get("emp_id") or row["emp_id"] or "", cur.get("db_name") or row["db_name"], cur.get("status") or row["status"], row["id"]])

    ws5 = wb.create_sheet("Summary")
    ws5.append(["Metric", "Value"])
    style_header(ws5, 2)
    ws5.append(["DB employees", len(db_rows)])
    ws5.append(["Applied remaps", len(planned)])
    ws5.append(["Next new EMP-ID", next_id])
    ws5.append(["Status", "Applied"])
    path.parent.mkdir(parents=True, exist_ok=True)
    wb.save(path)


if __name__ == "__main__":
    raise SystemExit(main())
