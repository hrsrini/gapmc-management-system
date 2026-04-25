/**
 * Build docs/SRS-v3.0-FR-TRACEABILITY.xlsx from docs/SRS-v3.0-FR-TRACEABILITY.csv.
 * Run after: python scripts/generate-srs-v3-fr-traceability.py
 * Or: npm run srs:fr-traceability
 */
import XLSX from "xlsx";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const CSV_PATH = path.join(root, "docs", "SRS-v3.0-FR-TRACEABILITY.csv");
const OUT_PATH = path.join(root, "docs", "SRS-v3.0-FR-TRACEABILITY.xlsx");

function parseCsv(text) {
  const rows = [];
  let i = 0;
  let field = "";
  let row = [];
  let inQuotes = false;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function main() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`Missing ${path.relative(root, CSV_PATH)} — run python scripts/generate-srs-v3-fr-traceability.py first.`);
    process.exit(1);
  }
  const raw = fs.readFileSync(CSV_PATH, "utf8");
  const table = parseCsv(raw);
  if (table.length < 2) {
    console.error("CSV has no data rows.");
    process.exit(1);
  }
  const headers = table[0];
  const objects = table.slice(1).map((cells) => {
    const o = {};
    headers.forEach((h, idx) => {
      o[h] = cells[idx] ?? "";
    });
    return o;
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(objects);
  ws["!cols"] = [
    { wch: 14 },
    { wch: 36 },
    { wch: 28 },
    { wch: 28 },
    { wch: 28 },
    { wch: 36 },
    { wch: 72 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, "FR traceability");
  XLSX.writeFile(wb, OUT_PATH);
  console.log(`Wrote ${path.relative(root, OUT_PATH)} (${objects.length} rows)`);
}

main();
