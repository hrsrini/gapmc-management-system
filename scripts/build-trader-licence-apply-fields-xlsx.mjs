/**
 * Build docs/M02-Trader-Licence-Apply-Fields.xlsx — Apply for Licence form field inventory.
 * Run: node scripts/build-trader-licence-apply-fields-xlsx.mjs
 */
import XLSX from "xlsx";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const OUT = path.join(root, "docs", "M02-Trader-Licence-Apply-Fields.xlsx");

const LICENCE_TYPES = ["Associated", "Functionary", "Hamali", "Weighman", "AssistantTrader"];
const APPLICATION_KIND = ["New", "Renewal"];
const SUBMIT_STATUS = ["Draft", "Pending"];

const GOVT_GST_EXEMPT_CATEGORIES = [
  { value: "(none)", label: "None (standard GST)" },
  { value: "gec_01", label: "GOVT-ADT — Assistant Director of Transport." },
  { value: "gec_02", label: "GOVT-CDPO — Child Development Project Officer." },
  { value: "gec_03", label: "GOVT-DMI — Directorate of Marketing & Inspection (DMI)." },
  { value: "gec_04", label: "GOVT-LM — The Inspector of Legal Metrology (Weights & Measures)." },
  { value: "gec_05", label: "GOVT-DAC — The Director of Arts & Culture (Central Library)." },
  { value: "gec_06", label: "GOVT-AEE — The Assistant Engineer Electricity." },
  { value: "gec_07", label: "GOVT-GSHCL — Goa State Horticultural Corporation Ltd." },
];

/** @type {Array<Record<string, string>>} */
const FIELDS = [
  // Section: Core
  { section: "Core — Business & contact", fieldLabel: "Firm / trader name", fieldKey: "firmName", fieldType: "Text", requiredDraft: "Yes", requiredPending: "Yes", dropdownValues: "", validationNotes: "Non-empty string", shownWhen: "Always" },
  { section: "Core — Business & contact", fieldLabel: "Firm type", fieldKey: "firmType", fieldType: "Text", requiredDraft: "No", requiredPending: "No", dropdownValues: "", validationNotes: "Free text (e.g. Partnership, Proprietorship)", shownWhen: "Always" },
  { section: "Core — Business & contact", fieldLabel: "Yard", fieldKey: "yardId", fieldType: "Dropdown", requiredDraft: "Yes", requiredPending: "Yes", dropdownValues: "Dynamic — see Dropdown Values sheet (Yard)", validationNotes: "User must have access to selected yard; locations where type = yard", shownWhen: "Always" },
  { section: "Core — Business & contact", fieldLabel: "Contact name", fieldKey: "contactName", fieldType: "Text", requiredDraft: "No", requiredPending: "No", dropdownValues: "", validationNotes: "", shownWhen: "Always" },
  { section: "Core — Business & contact", fieldLabel: "Licence type", fieldKey: "licenceType", fieldType: "Dropdown", requiredDraft: "Yes", requiredPending: "Yes", dropdownValues: LICENCE_TYPES.join(", "), validationNotes: "Default: Associated", shownWhen: "Always" },
  { section: "Core — Business & contact", fieldLabel: "Mobile", fieldKey: "mobile", fieldType: "Text (10-digit)", requiredDraft: "Yes", requiredPending: "Yes", dropdownValues: "", validationNotes: "10 digits, starts 6–9; unique among Draft/Pending/Query/Active licences", shownWhen: "Always" },
  { section: "Core — Business & contact", fieldLabel: "Email", fieldKey: "email", fieldType: "Email", requiredDraft: "No", requiredPending: "No", dropdownValues: "", validationNotes: "Valid email format if provided; stored lowercase", shownWhen: "Always" },
  { section: "Core — Business & contact", fieldLabel: "Address", fieldKey: "address", fieldType: "Textarea", requiredDraft: "No", requiredPending: "No", dropdownValues: "", validationNotes: "", shownWhen: "Always" },
  { section: "Core — Business & contact", fieldLabel: "Aadhaar", fieldKey: "aadhaarToken", fieldType: "Text (12-digit)", requiredDraft: "No", requiredPending: "No", dropdownValues: "", validationNotes: "Optional; exactly 12 digits if entered; stored masked XXXX-XXXX-####", shownWhen: "Always" },
  { section: "Core — Business & contact", fieldLabel: "PAN", fieldKey: "pan", fieldType: "Text", requiredDraft: "No", requiredPending: "No", dropdownValues: "", validationNotes: "Format ABCDE1234F; must be unique", shownWhen: "Always" },
  { section: "Core — Business & contact", fieldLabel: "GSTIN", fieldKey: "gstin", fieldType: "Text", requiredDraft: "No", requiredPending: "No", dropdownValues: "", validationNotes: "No strict format validation on create", shownWhen: "Always" },
  { section: "Core — Business & contact", fieldLabel: "Fee amount (₹)", fieldKey: "feeAmount", fieldType: "Number (decimal)", requiredDraft: "No", requiredPending: "No", dropdownValues: "", validationNotes: "Defaults from system_config.licence_fee if omitted on create", shownWhen: "Always" },
  { section: "Core — Business & contact", fieldLabel: "Valid from", fieldKey: "validFrom", fieldType: "Date", requiredDraft: "No", requiredPending: "No", dropdownValues: "", validationNotes: "YYYY-MM-DD", shownWhen: "Always" },
  { section: "Core — Business & contact", fieldLabel: "Valid to", fieldKey: "validTo", fieldType: "Date", requiredDraft: "No", requiredPending: "No", dropdownValues: "", validationNotes: "YYYY-MM-DD", shownWhen: "Always" },
  { section: "Core — Business & contact", fieldLabel: "Declared non-GST entity", fieldKey: "isNonGstEntity", fieldType: "Checkbox", requiredDraft: "No", requiredPending: "No", dropdownValues: "true, false", validationNotes: "Default false", shownWhen: "Always" },
  // GST exempt
  { section: "Govt GST exemption", fieldLabel: "Govt. GST exempt category", fieldKey: "govtGstExemptCategoryId", fieldType: "Dropdown", requiredDraft: "No", requiredPending: "No", dropdownValues: "See Dropdown Values sheet (Govt GST exempt category)", validationNotes: "None = standard GST; affects zero CGST/SGST on rent", shownWhen: "Always" },
  // Form BM
  { section: "Form BM — Market functionary", fieldLabel: "Father / spouse name", fieldKey: "fatherSpouseName", fieldType: "Text", requiredDraft: "No", requiredPending: "Yes", dropdownValues: "", validationNotes: "Required on submit for BM licence types", shownWhen: "Licence type = Functionary, Hamali, Weighman, or AssistantTrader" },
  { section: "Form BM — Market functionary", fieldLabel: "Date of birth", fieldKey: "dateOfBirth", fieldType: "Date", requiredDraft: "No", requiredPending: "Yes", dropdownValues: "", validationNotes: "YYYY-MM-DD; cannot be in future", shownWhen: "Licence type = Functionary, Hamali, Weighman, or AssistantTrader" },
  { section: "Form BM — Market functionary", fieldLabel: "Emergency contact mobile", fieldKey: "emergencyContactMobile", fieldType: "Text (10-digit)", requiredDraft: "No", requiredPending: "Yes", dropdownValues: "", validationNotes: "Same rules as primary mobile", shownWhen: "Licence type = Functionary, Hamali, Weighman, or AssistantTrader" },
  { section: "Form BM — Market functionary", fieldLabel: "Character certificate — issuing authority", fieldKey: "characterCertIssuer", fieldType: "Text", requiredDraft: "No", requiredPending: "Yes", dropdownValues: "", validationNotes: "", shownWhen: "Licence type = Functionary, Hamali, Weighman, or AssistantTrader" },
  { section: "Form BM — Market functionary", fieldLabel: "Character certificate — date", fieldKey: "characterCertDate", fieldType: "Date", requiredDraft: "No", requiredPending: "No", dropdownValues: "", validationNotes: "YYYY-MM-DD if provided", shownWhen: "Licence type = Functionary, Hamali, Weighman, or AssistantTrader" },
  { section: "Form BM — Market functionary", fieldLabel: "Form BM undertaking", fieldKey: "bmUndertakingAccepted", fieldType: "Checkbox", requiredDraft: "No", requiredPending: "Yes", dropdownValues: "true", validationNotes: "Must be checked on submit for BM types", shownWhen: "Licence type = Functionary, Hamali, Weighman, or AssistantTrader" },
  { section: "Form BM — Market functionary", fieldLabel: "Supporting document — URL", fieldKey: "bmFormDocUrl", fieldType: "URL", requiredDraft: "No", requiredPending: "No", dropdownValues: "", validationNotes: "http/https; max 4000 chars", shownWhen: "Licence type = Functionary, Hamali, Weighman, or AssistantTrader" },
  { section: "Form BM — Market functionary", fieldLabel: "Supporting document — file", fieldKey: "bmFormDocFile", fieldType: "File upload", requiredDraft: "No", requiredPending: "No", dropdownValues: "PDF, PNG, JPEG", validationNotes: "Max 2 MB; edit only (after first save); locked after licence issued", shownWhen: "Licence type = Functionary, Hamali, Weighman, or AssistantTrader" },
  // Form BK renewal
  { section: "Form BK — Renewal", fieldLabel: "No outstanding arrears declaration", fieldKey: "renewalNoArrearsDeclared", fieldType: "Checkbox", requiredDraft: "No", requiredPending: "Yes", dropdownValues: "true", validationNotes: "Required on submit for renewals only (Form BK / Section 54)", shownWhen: "applicationKind = Renewal" },
  { section: "Form BK — Renewal", fieldLabel: "Parent licence fee (read-only)", fieldKey: "parentLicenceFeeSnapshot", fieldType: "Display only", requiredDraft: "No", requiredPending: "No", dropdownValues: "", validationNotes: "Set when renewal draft created from parent", shownWhen: "applicationKind = Renewal" },
  // Actions
  { section: "Submit actions", fieldLabel: "Save draft", fieldKey: "status", fieldType: "Button action", requiredDraft: "—", requiredPending: "—", dropdownValues: "Draft", validationNotes: "Sets status to Draft", shownWhen: "Always" },
  { section: "Submit actions", fieldLabel: "Submit for review", fieldKey: "status", fieldType: "Button action", requiredDraft: "—", requiredPending: "—", dropdownValues: "Pending", validationNotes: "Sets status to Pending; triggers BM/BK validation", shownWhen: "Always" },
];

/** @type {Array<[string, string, string, string]>} */
const DROPDOWN_ROWS = [
  ["Field", "Option value", "Option label", "Notes"],
  ["Licence type", "Associated", "Associated", "Default for new applications"],
  ["Licence type", "Functionary", "Functionary", "Shows Form BM fields"],
  ["Licence type", "Hamali", "Hamali", "Shows Form BM fields"],
  ["Licence type", "Weighman", "Weighman", "Shows Form BM fields"],
  ["Licence type", "AssistantTrader", "AssistantTrader", "Shows Form BM fields"],
  ["Application kind", "New", "New", "Set at creation; not editable"],
  ["Application kind", "Renewal", "Renewal", "Created via Renew action on parent licence"],
  ["Submit status", "Draft", "Draft", "Save draft button"],
  ["Submit status", "Pending", "Pending", "Submit for review button"],
  ["Declared non-GST entity", "false", "No (default)", ""],
  ["Declared non-GST entity", "true", "Yes", ""],
  ["Form BM undertaking", "false", "Unchecked", "Invalid for Pending submit"],
  ["Form BM undertaking", "true", "Checked", "Required for Pending + BM types"],
  ["Renewal arrears declaration", "false", "Unchecked", "Invalid for Pending renewal"],
  ["Renewal arrears declaration", "true", "Checked", "Required for Pending renewal"],
  ["BM document file type", "application/pdf", "PDF", "Max 2 MB"],
  ["BM document file type", "image/png", "PNG", "Max 2 MB"],
  ["BM document file type", "image/jpeg", "JPEG", "Max 2 MB"],
  ...GOVT_GST_EXEMPT_CATEGORIES.map((c) => ["Govt GST exempt category", c.value, c.label, "From govt_gst_exempt_categories / seed"]),
  ["Yard", "(dynamic)", "(yard name from Admin → Locations)", "API: GET /api/yards — filter type=yard; value = yard id"],
];

const FIELDS_HEADER = [
  "Section",
  "Field label",
  "API field key",
  "Field type",
  "Required (Draft)",
  "Required (Pending submit)",
  "Dropdown / allowed values",
  "Validation notes",
  "Shown when",
];

const fieldsAoa = [
  FIELDS_HEADER,
  ...FIELDS.map((f) => [
    f.section,
    f.fieldLabel,
    f.fieldKey,
    f.fieldType,
    f.requiredDraft,
    f.requiredPending,
    f.dropdownValues,
    f.validationNotes,
    f.shownWhen,
  ]),
];

const readmeAoa = [
  ["M-02 Trader Licence — Apply for Licence field inventory"],
  [""],
  ["Module", "M-02 Trader & Asset ID Management"],
  ["Form UI", "client/src/pages/traders/TraderLicenceForm.tsx"],
  ["Routes", "/traders/licences/new , /traders/licences/:id/edit"],
  ["Create API", "POST /api/ioms/traders/licences"],
  ["Update API", "PUT /api/ioms/traders/licences/:id"],
  ["BM file upload", "POST /api/ioms/traders/licences/:id/bm-form-document (field: file)"],
  [""],
  ["Sheets in this workbook"],
  ["1. Apply for Licence — Fields", "All form fields with types, required rules, and dropdown hints"],
  ["2. Dropdown Values", "Fixed dropdown options and reference lists"],
  ["3. Read me", "This sheet"],
  [""],
  ["Note", "Premises allotment and opening stock are captured after application on the licence detail screen, not on this form."],
];

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(readmeAoa), "Read me");
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(fieldsAoa), "Apply for Licence - Fields");
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(DROPDOWN_ROWS), "Dropdown Values");

fs.mkdirSync(path.dirname(OUT), { recursive: true });
XLSX.writeFile(wb, OUT);
console.log("Written:", OUT);
