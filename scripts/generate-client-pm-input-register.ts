/**
 * Generates docs/Client-PM-Input-Register.xlsx for GAPLMB PM to track client-side inputs.
 * Run: npx tsx scripts/generate-client-pm-input-register.ts
 */
import XLSX from "xlsx";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(__dirname, "..", "docs", "Client-PM-Input-Register.xlsx");

type Row = (string | number)[];

const instructions: Row[] = [
  ["Client PM input register — GAPLMB / IOMS backlog"],
  [""],
  [
    "How to use: Assign an internal owner per row. Set Status to Pending | In progress | Received | N/A.",
  ],
  ["Attach file names, policy PDFs, or email refs in the Notes column when Received."],
  [""],
  ["Source: docs/SRS-IMPLEMENTATION-BACKLOG.md + client dependency register (Eng chat)."],
  [""],
];

const header: Row[] = [
  "#",
  "Priority",
  "Backlog ref",
  "Topic / SRS",
  "What GAPLMB must provide (deliverable)",
  "Backlog owner",
  "GAPLMB internal owner (name)",
  "Status",
  "Target date",
  "Notes / evidence link",
];

const data: Row[] = [
  [
    1,
    "P2",
    "#48",
    "§8.6 FR-PRT-001 — Letterhead / receipt branding",
    "Official letterhead assets (logo, layout rules) per clarification Q48; files for pre-printed or body-only PDF use.",
    "Client",
    "",
    "Pending",
    "",
    "",
  ],
  [
    2,
    "P0",
    "SSO",
    "§13.1 / §14.2 / §15.2 — SSO + MFA",
    "IdP choice (OIDC or SAML); tenant URLs; client ID/secret or certs; redirect URIs per env; attribute mapping to app users/roles; MFA policy; UAT test users.",
    "Eng + Client IdP",
    "",
    "Pending",
    "",
    "",
  ],
  [
    3,
    "P0",
    "#15",
    "§6.1 FR-RENT-005 — TDS + GL",
    "Signed GL rules: accounts, Dr/Cr, posting timing (invoice vs receipt vs remittance), reversals; whether marginal first-month-over-threshold TDS applies.",
    "Eng (Finance input)",
    "",
    "Pending",
    "",
    "See CLIENT-CLARIFICATION Q15",
  ],
  [
    4,
    "P0",
    "#33",
    "§15.1 — Object storage / encryption",
    "Approved cloud object store (or NIC S3-compatible); bucket/region; IAM; SSE-S3 vs KMS requirement; cutover window and approval for disk→bucket migration.",
    "Eng + Infra",
    "",
    "Pending",
    "",
    "See Q33 / Q46",
  ],
  [
    5,
    "P0",
    "§8.6 DSC",
    "FR-PRT-001 — Digital signature",
    "Policy: class of DSC/HSM, which documents must be signed, approved CA/vendor, authorised signatories.",
    "Eng",
    "",
    "Pending",
    "",
    "See Q52 channel vs DSC",
  ],
  [
    6,
    "P1",
    "#50",
    "§16.2 — Data retention",
    "Legal/compliance stance: archive-only vs purge allowed; formal retention years per module if different from defaults; session/login retention when applicable.",
    "Eng",
    "",
    "Pending",
    "",
    "See Q50",
  ],
  [
    7,
    "P1",
    "#49",
    "§8.3 FR-RCP-008 — Tally export",
    "Finance UAT: import CSV/XML in Tally Prime (or agreed tool); signed list of gaps or sign-off.",
    "Eng",
    "",
    "Pending",
    "",
    "See Q49",
  ],
  [
    8,
    "P1",
    "#17",
    "§6.1 FR-RENT-003 — GSTR-1",
    "Target filing software; sample required JSON or CA checklist; POS/state code rules beyond current export placeholders.",
    "Eng",
    "",
    "Pending",
    "",
    "See Q17",
  ],
  [
    9,
    "P2",
    "#16",
    "FR-RENT-007 — Arrears / interest GL",
    "GL rules to post dishonour interest (heads, timing, amount basis).",
    "Eng (Finance input)",
    "",
    "Pending",
    "",
    "See Q16",
  ],
  [
    10,
    "P2",
    "#31",
    "BR-AST-35 / BR-RCP-34 — Dishonour bank charge",
    "Confirm auto bank-charge voucher: yes/no; default amount source; expenditure head / narrative for voucher line.",
    "Eng (Finance input)",
    "",
    "Pending",
    "",
    "See Q31",
  ],
  [
    11,
    "P2",
    "#28–30",
    "§8.3 FR-RCP-006 — 38 Tally heads",
    "Process owner when live chart ≠ 38: who (DA) corrects master data; target chart approval.",
    "Eng",
    "",
    "Pending",
    "",
    "See Q28–30",
  ],
  [
    12,
    "P2",
    "#39–40",
    "§10.1 FR-VEH — Fleet SLA",
    "Business rules for full BR-VEH parity: calendar SLA, alerts, escalation (beyond maintenance-due + digest).",
    "Eng",
    "",
    "Pending",
    "",
    "See Q39–40",
  ],
  [
    13,
    "P2",
    "#18–19",
    "§5.2 / §5.5 — Allottee / Pre-receipt",
    "Confirm flows vs SRS appendix with BA; any GAPLMB-specific exceptions in writing.",
    "Eng + BA",
    "",
    "Pending",
    "",
    "See Q18–19",
  ],
];

const legend: Row[] = [
  ["Owner (from backlog)", "Meaning"],
  ["Client", "GAPLMB supplies assets or formal client-only deliverables."],
  ["Eng + Client IdP", "IT supplies identity provider configuration and test tenants."],
  ["Eng + Infra", "Engineering implements; client cloud/IAM provides buckets, keys, cutover approval."],
  ["Eng (Finance input)", "Engineering implements after GAPLMB Finance signs rules."],
  ["Eng + BA", "Engineering + business analyst; client confirms business behaviour vs SRS."],
  ["Eng", "Primarily delivery team; PM may still coordinate UAT sign-off from business users."],
];

function main(): void {
  const wb = XLSX.utils.book_new();

  const mainSheet = XLSX.utils.aoa_to_sheet([...instructions, header, ...data]);
  mainSheet["!cols"] = [
    { wch: 4 },
    { wch: 8 },
    { wch: 14 },
    { wch: 36 },
    { wch: 52 },
    { wch: 22 },
    { wch: 28 },
    { wch: 14 },
    { wch: 12 },
    { wch: 36 },
  ];
  XLSX.utils.book_append_sheet(wb, mainSheet, "PM input register");

  const legendSheet = XLSX.utils.aoa_to_sheet([["Backlog owner legend"], [""], ...legend]);
  legendSheet["!cols"] = [{ wch: 28 }, { wch: 70 }];
  XLSX.utils.book_append_sheet(wb, legendSheet, "Owner legend");

  XLSX.writeFile(wb, outPath);
  console.log("Wrote:", outPath);
}

main();
