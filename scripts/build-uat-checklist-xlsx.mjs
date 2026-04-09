/**
 * Build docs/UAT-CHECKLIST-IOMS.xlsx from docs/test_plan.csv + supplementary rows.
 * Run: node scripts/build-uat-checklist-xlsx.mjs
 */
import XLSX from "xlsx";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const CSV_PATH = path.join(root, "docs", "test_plan.csv");
const OUT_PATH = path.join(root, "docs", "UAT-CHECKLIST-IOMS.xlsx");

/** Lower number = earlier in UAT runbook */
function phaseSortKey(row) {
  const m = String(row.module || "").trim();
  const fa = String(row.functional_area || "");
  const id = String(row.test_id || "");

  if (m === "Data") return { key: 5, label: "Phase 0 — Environment & seed data" };
  if (m === "Cross-cutting") {
    if (/Performance|Security session|NFR|Accessibility|PWA|OFFLINE/i.test(fa)) {
      return { key: 220, label: "Phase 12 — Non-functional & quality bar" };
    }
    return { key: 15, label: "Phase 1 — Login, session, RBAC, public verify, ops hooks" };
  }
  if (m === "M-10") return { key: 25, label: "Phase 2 — M-10 Administration & governance" };
  if (m === "Users") return { key: 27, label: "Phase 2 — User ↔ employee rules (with M-10)" };
  if (m === "M-01") return { key: 35, label: "Phase 3 — M-01 HRMS (employees, leave, claims, attendance)" };
  if (m === "M-02") return { key: 45, label: "Phase 4 — M-02 Traders, licences, assets, MSP" };
  if (m === "M-03") return { key: 55, label: "Phase 5 — M-03 Rent, GST invoices, credit notes, ledger" };
  if (m === "Finance" && /TDS|Deferred/i.test(String(row.expected_result || ""))) {
    return { key: 56, label: "Phase 5 — M-03 (deferred / client-pending items)" };
  }
  if (m === "M-04") return { key: 65, label: "Phase 6 — M-04 Market, commodities, check post" };
  if (m === "Market") return { key: 66, label: "Phase 6 — M-04 (extended market / SRS slices)" };
  if (id.startsWith("TP-MKT")) return { key: 66, label: "Phase 6 — M-04 (extended market / SRS slices)" };
  if (m === "M-05") return { key: 75, label: "Phase 7 — M-05 Receipts & reconciliation" };
  if (m === "Reports") return { key: 78, label: "Phase 7b — IOMS reports & exports (cross-module)" };
  if (m === "M-06") return { key: 85, label: "Phase 8 — M-06 Vouchers, advances, monthly statement" };
  if (m === "M-07") return { key: 95, label: "Phase 9 — M-07 Fleet" };
  if (m === "M-08") return { key: 105, label: "Phase 10 — M-08 Works, AMC, land, fixed assets" };
  if (m === "M-09") return { key: 115, label: "Phase 11 — M-09 Dak / correspondence" };
  if (m === "Correspondence" || id.startsWith("TP-COR")) {
    return { key: 116, label: "Phase 11 — M-09 (correspondence use cases)" };
  }
  if (m === "Workflow") return { key: 118, label: "Phase 11b — Workflow & segregation (all modules)" };
  if (m === "Bugs") return { key: 125, label: "Phase 13 — Bug tracking (support)" };
  if (m === "Legacy") return { key: 130, label: "Phase 14 — Legacy screens (parallel paths)" };
  if (m === "UAT") return { key: 200, label: "Phase 15 — End-to-end business journeys (sign-off)" };
  if (m === "Open items") return { key: 210, label: "Phase 16 — Open items / exclusions / traceability" };
  if (m === "Non-functional") return { key: 220, label: "Phase 12 — Non-functional & quality bar" };
  return { key: 999, label: "Phase 99 — Unclassified (review)" };
}

function readTestPlanRows() {
  const raw = fs.readFileSync(CSV_PATH, "utf8");
  const wb = XLSX.read(raw, { type: "string", raw: false, codepage: 65001 });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
  if (aoa.length < 2) return [];
  const headers = aoa[0].map((h) => String(h).trim());
  const rows = [];
  for (let r = 1; r < aoa.length; r++) {
    const line = aoa[r];
    if (!line || line.every((c) => c === "")) continue;
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = line[i] != null ? String(line[i]) : "";
    });
    rows.push(obj);
  }
  return rows;
}

/** Human-readable “what is built” blurb */
function descriptionBuilt(row) {
  const fa = row.functional_area || "";
  const cat = row.test_category || "";
  const mod = row.module || "";
  return `${mod} — ${fa}${cat ? ` (${cat})` : ""}. See Expected result for acceptance criteria.`;
}

/** Extra rows not yet in test_plan.csv (keep empty when CSV is canonical). */
const SUPPLEMENTARY = [];

function buildRows() {
  const fromCsv = readTestPlanRows();
  const merged = [...fromCsv, ...SUPPLEMENTARY];
  const enriched = merged.map((row) => {
    const { key, label } = phaseSortKey(row);
    return {
      _sortKey: key,
      _phaseLabel: label,
      test_id: row.test_id || "",
      module: row.module || "",
      functional_area: row.functional_area || "",
      test_category: row.test_category || "",
      priority: row.priority || "",
      persona_or_role: row.persona_or_role || "",
      preconditions: row.preconditions || "",
      test_steps: row.test_steps || "",
      expected_result: row.expected_result || "",
      test_data_notes: row.test_data_notes || "",
      open_questions_exclusions: row.open_questions_exclusions || row.open_questions || "",
      srs_reference: row.srs_reference || "",
      qa_status: row.qa_status || row.release_phase || "",
      description_built: descriptionBuilt(row),
    };
  });

  enriched.sort((a, b) => {
    if (a._sortKey !== b._sortKey) return a._sortKey - b._sortKey;
    const pa = a.priority === "P0" ? 0 : a.priority === "P1" ? 1 : a.priority === "P2" ? 2 : 3;
    const pb = b.priority === "P0" ? 0 : b.priority === "P1" ? 1 : b.priority === "P2" ? 2 : 3;
    if (pa !== pb) return pa - pb;
    return String(a.test_id).localeCompare(String(b.test_id));
  });

  let seq = 1;
  return enriched.map((r) => {
    const out = {
      Seq: seq++,
      Execution_phase: r._phaseLabel,
      Phase_sort: r._sortKey,
      Module: r.module,
      Functional_area: r.functional_area,
      Test_ID: r.test_id,
      Test_category: r.test_category,
      Priority: r.priority,
      Description_what_is_developed: r.description_built,
      What_to_test_steps: r.test_steps,
      Preconditions: r.preconditions,
      Expected_result: r.expected_result,
      Suggested_role: r.persona_or_role,
      Test_data_notes: r.test_data_notes,
      Open_questions_or_exclusions: r.open_questions_exclusions,
      Dev_QA_readiness: r.qa_status,
      UAT_Result: "",
      UAT_Comments: "",
      Defect_ID: "",
      Test_date: "",
      Tester_name: "",
      SRS_or_reference: r.srs_reference,
    };
    return out;
  });
}

function main() {
  const data = buildRows();
  const headers = Object.keys(data[0] || {}).filter((h) => h !== "Phase_sort");
  const aoa = [
    headers,
    ...data.map((row) => headers.map((h) => row[h] ?? "")),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = headers.map((h) => {
    if (h === "Seq") return { wch: 5 };
    if (h === "Execution_phase") return { wch: 42 };
    if (h === "Description_what_is_developed") return { wch: 48 };
    if (h === "What_to_test_steps") return { wch: 56 };
    if (h === "Expected_result") return { wch: 44 };
    if (h === "UAT_Comments") return { wch: 36 };
    return { wch: 22 };
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "UAT checklist");

  const phases = [
    ["Execution order (run approximately top to bottom)"],
    [""],
    ["Phase 0", "Environment & seed data (DB verify, seed scripts, role smoke login)"],
    ["Phase 1", "Cross-cutting: login, session, RBAC, location scope, public verify, health, cron/API smoke"],
    ["Phase 2", "M-10 Admin: roles, locations, config, audit, permission matrix, SLA config, finance mappings"],
    ["Phase 3", "M-01 HR: employees (incl. BR-EMP), leave, claims (LTC/TA-DA), attendance, timesheets, recruitment"],
    ["Phase 4", "M-02 Traders directory, IOMS licences, assistants, blocking log, assets, allotments, vacant, MSP"],
    ["Phase 5", "M-03 IOMS rent invoices, credit notes, rent deposit ledger, GSTR/reports, crons"],
    ["Phase 6", "M-04 Commodities, fee rates, farmers, transactions, check post, legacy market fee screens"],
    ["Phase 7", "M-05 IOMS receipts, legacy receipts, reconciliation, cheque dishonour, IOMS reports export"],
    ["Phase 8", "M-06 Vouchers workflow, advances, monthly statement exports"],
    ["Phase 9", "M-07 Fleet vehicles, trips, fuel, maintenance"],
    ["Phase 10", "M-08 Works, AMC, land, fixed assets, construction reports"],
    ["Phase 11", "M-09 Dak inward/outward, my pending, escalations, SLA report, subject index"],
    ["Phase 11b", "Workflow segregation rules (DO/DV/DA) across applicable modules"],
    ["Phase 12", "Non-functional: performance smoke, session security, PWA/a11y baseline"],
    ["Phase 13", "Bugs module"],
    ["Phase 14", "Legacy parallel paths (legacy rent/traders if still in use)"],
    ["Phase 15", "End-to-end UAT journeys — steering sign-off"],
    ["Phase 16", "Open items / exclusions / traceability to client clarifications"],
    [""],
    ["Columns UAT_Result: use Pass | Fail | Blocked | Deferred | N/A"],
    ["Source rows: docs/test_plan.csv (regenerate this workbook after CSV updates)"],
  ];
  const ws2 = XLSX.utils.aoa_to_sheet(phases);
  ws2["!cols"] = [{ wch: 14 }, { wch: 100 }];
  XLSX.utils.book_append_sheet(wb, ws2, "How to execute");

  XLSX.writeFile(wb, OUT_PATH);
  console.log("Wrote", OUT_PATH, "rows:", data.length);
}

main();
