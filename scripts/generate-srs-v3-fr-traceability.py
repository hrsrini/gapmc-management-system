"""
Extract FR-* IDs from requirements/GAPLMB-GOA-IOMS-SRS-v3.0.pdf and emit
docs/SRS-v3.0-FR-TRACEABILITY.csv (SRS v3.0 FR -> module, test refs, status).

Run: python scripts/generate-srs-v3-fr-traceability.py
"""
from __future__ import annotations

import csv
import re
from collections import defaultdict
from pathlib import Path

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
PDF = ROOT / "requirements" / "GAPLMB-GOA-IOMS-SRS-v3.0.pdf"
TEST_PLAN = ROOT / "docs" / "test_plan.csv"
OUT = ROOT / "docs" / "SRS-v3.0-FR-TRACEABILITY.csv"

# Prefix / family -> IOMS module or cross-cutting bucket
PREFIX_MODULE: list[tuple[str, str]] = [
    ("FR-EMP-", "M-01 HRMS"),
    ("FR-LVE-", "M-01 HRMS (leave)"),
    ("FR-LTC-", "M-01 HRMS (LTC)"),
    ("FR-TADA-", "M-01 HRMS (TA/DA)"),
    ("FR-PRE-", "M-02 Track B / pre-receipt"),
    ("FR-RENT-", "M-03 Rent / GST"),
    ("FR-MKT-", "M-04 Market fee"),
    ("FR-RCP-", "M-05 Receipts"),
    ("FR-PRT-", "M-05 / §8.6 Printing"),
    ("FR-PAY-", "M-06 Payment vouchers"),
    ("FR-VEH-", "M-07 Fleet"),
    ("FR-CNST-", "M-08 Construction"),
    ("FR-AST-", "M-08 Assets"),
    ("FR-COR-", "M-09 Correspondence"),
    ("FR-USR-", "M-10 Users / coupling"),
    ("FR-USA-", "M-10 Usability / UI"),
    ("FR-SEC-", "NFR §14 Security"),
    ("FR-PERF-", "NFR §14 Performance"),
    ("FR-AVAIL-", "NFR §14 Availability"),
    ("FR-MNT-", "NFR §14 Maintainability"),
    ("FR-NRT-", "NFR §14 Notifications"),
    ("FR-CFG-", "NFR / Admin config"),
    ("FR-CHG-", "NFR Change / release (SRS)"),
]

# Explicit engineering status vs repo (from SRS-IMPLEMENTATION-BACKLOG + test_plan)
STATUS_OVERRIDE: dict[str, tuple[str, str]] = {
    "FR-RENT-005": ("Partial", "Invoice+receipt TDS fields; TDS GL posting not built (Q15)."),
    "FR-RENT-003": ("Partial", "GSTR-1 export + warnings; filing-tool final schema / POS TBD (Q17)."),
    "FR-RENT-007": ("Partial", "Arrears disclosure on receipt/PDF; interest GL TBD (Q16)."),
    "FR-PRT-001": ("Partial", "Server PDF + signatory text + print modes; DSC/HSM not built (Q52)."),
    "FR-RCP-008": ("Partial", "Tally CSV + interchange XML; Prime import UAT TBD (Q49)."),
    "FR-RCP-006": ("Partial", "Ledger stats vs SRS 38 heads — DA sign-off if chart differs (Q28–30)."),
    "FR-USR-004": ("Deferred", "MFA not implemented; TP-USR-MFA pending_not_in_scope."),
    "FR-COR-002": ("Partial", "Dak workflow; UC-COR-01 state names may be simplified (TP-COR-UC01-001)."),
}


def extract_frs_from_pdf(path: Path) -> set[str]:
    reader = PdfReader(str(path))
    flat = re.sub(r"\s+", " ", "\n".join((p.extract_text() or "") for p in reader.pages))
    tight = set(re.findall(r"FR-[A-Z][A-Z0-9]*-\d{1,4}\b", flat))
    spaced = re.findall(r"FR-\s*([A-Z][A-Z0-9]*)\s*-\s*(\d{1,4})\b", flat, flags=re.I)
    spaced_set = {f"FR-{a.upper()}-{b}" for a, b in spaced}
    return tight | spaced_set


def module_for_fr(fr_id: str) -> str:
    for prefix, mod in PREFIX_MODULE:
        if fr_id.startswith(prefix):
            return mod
    return "Unmapped (check SRS)"


def load_test_plan_fr_index() -> dict[str, list[dict[str, str]]]:
    fr_pat = re.compile(
        r"FR-[A-Z][A-Z0-9]*-\d{1,4}\b|FR-AVAIL-\d{2}\b|FR-PERF-\d{2}\b|FR-USA-\d{2}\b|FR-SEC-\d{2}\b|FR-MNT-\d{2}\b"
    )
    by_fr: dict[str, list[dict[str, str]]] = defaultdict(list)
    with TEST_PLAN.open(encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            blob = " ".join(
                filter(
                    None,
                    [
                        row.get("srs_reference") or "",
                        row.get("open_questions_exclusions") or "",
                    ],
                )
            )
            for m in fr_pat.finditer(blob):
                fid = m.group(0)
                # Normalize FR-MNT-4 -> FR-MNT-04 style if needed
                by_fr[fid].append(
                    {
                        "test_id": row.get("test_id") or "",
                        "qa_status": row.get("qa_status") or "",
                        "release_phase": row.get("release_phase") or "",
                    }
                )
    return by_fr


def main() -> None:
    frs = sorted(extract_frs_from_pdf(PDF))
    tp_index = load_test_plan_fr_index()

    rows: list[dict[str, str]] = []
    for fr in frs:
        mod = module_for_fr(fr)
        tp_hits = tp_index.get(fr, [])
        test_ids = ";".join(sorted({h["test_id"] for h in tp_hits if h["test_id"]}))
        qa = ";".join(sorted({h["qa_status"] for h in tp_hits if h["qa_status"]}))

        if fr in STATUS_OVERRIDE:
            status, note = STATUS_OVERRIDE[fr]
        elif tp_hits:
            # If any linked test is explicitly out of scope, surface it
            phases = {h["release_phase"] for h in tp_hits if h.get("release_phase")}
            if "pending_not_in_scope" in qa:
                status = "Deferred / out of scope (see test_plan)"
                note = "Linked TP marked pending_not_in_scope."
            else:
                status = "Implemented (test_plan link)"
                note = "At least one test_plan row references this FR."
        elif mod.startswith("NFR"):
            status = "NFR (spot-check / infra)"
            note = "Cross-cutting; verify against §14 deployment checklist + TP-NF-* / TP-NFR-*."
        else:
            status = "Module delivered (no explicit TP row)"
            note = "Feature area exists in app; add srs_reference to test_plan for strict RTM."

        rows.append(
            {
                "fr_id": fr,
                "srs_document": "GAPLMB-GOA-IOMS-SRS-v3.0.pdf",
                "iom_module_or_nfr": mod,
                "test_plan_test_ids": test_ids,
                "test_plan_qa_status": qa,
                "repo_trace_status": status,
                "notes": note,
            }
        )

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(
            f,
            fieldnames=[
                "fr_id",
                "srs_document",
                "iom_module_or_nfr",
                "test_plan_test_ids",
                "test_plan_qa_status",
                "repo_trace_status",
                "notes",
            ],
        )
        w.writeheader()
        w.writerows(rows)

    print(f"Wrote {len(rows)} rows to {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
