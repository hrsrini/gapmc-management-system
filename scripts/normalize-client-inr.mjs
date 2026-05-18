/**
 * One-off: add formatInr import and replace common ₹ + toLocaleString patterns in client/src.
 * Run: node scripts/normalize-client-inr.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "client", "src");
const IMPORT = 'import { formatInr, formatInrSigned } from "@/lib/formatInr";';
const IMPORT_SINGLE = 'import { formatInr } from "@/lib/formatInr";';

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (ent.name.endsWith(".tsx") || ent.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

function relImportDepth(filePath) {
  const rel = path.relative(path.join(root, "pages"), filePath);
  const depth = rel.split(path.sep).length - 1;
  return depth <= 0 ? "@/lib/formatInr" : "../".repeat(depth) + "lib/formatInr";
}

function ensureImport(content, filePath) {
  if (content.includes('from "@/lib/formatInr"') || content.includes("formatInr")) {
    if (!content.includes("formatInr")) return content;
    if (content.includes('from "@/lib/formatInr"')) return content;
  }
  if (!content.match(/₹|formatInr/)) return content;
  const usesSigned = content.includes("formatInrSigned");
  const imp = usesSigned ? IMPORT : IMPORT_SINGLE;
  const lastImport = content.lastIndexOf("\nimport ");
  if (lastImport === -1) return imp + "\n" + content;
  const lineEnd = content.indexOf("\n", lastImport);
  return content.slice(0, lineEnd + 1) + imp + "\n" + content.slice(lineEnd + 1);
}

function transform(content) {
  let c = content;

  // Skip formatInr.ts itself
  if (c.includes("export function formatInr")) return c;

  // Signed ledger pattern
  c = c.replace(
    /\`\$\{Number\(([^)]+)\) >= 0 \? "\+" : ""\}₹\$\{Math\.abs\(Number\(([^)]+)\)\)\.toLocaleString\("en-IN"\)\}\`/g,
    "${formatInrSigned($1)}",
  );

  // Template: ₹${...toLocaleString("en-IN")}
  c = c.replace(/`₹\$\{([^}]+)\.toLocaleString\("en-IN"\)\}`/g, "`${formatInr($1)}`");
  c = c.replace(/`₹\$\{Number\(([^)]+)\)\.toLocaleString\("en-IN"\)\}`/g, "`${formatInr($1)}`");

  // Template: ₹${...toLocaleString()}
  c = c.replace(/`₹\$\{([^}]+)\.toLocaleString\(\)\}`/g, "`${formatInr($1)}`");
  c = c.replace(/`₹\$\{Number\(([^)]+)\)\.toLocaleString\(\)\}`/g, "`${formatInr($1)}`");

  // JSX: ₹{...toLocaleString()}
  c = c.replace(/₹\{([^}]+)\.toLocaleString\("en-IN"\)\}/g, "{formatInr($1)}");
  c = c.replace(/₹\{Number\(([^)]+)\)\.toLocaleString\("en-IN"\)\}/g, "{formatInr($1)}");
  c = c.replace(/₹\{([^}]+)\.toLocaleString\(\)\}/g, "{formatInr($1)}");
  c = c.replace(/₹\{Number\(([^)]+)\)\.toLocaleString\(\)\}/g, "{formatInr($1)}");

  // ₹{bare number} without formatting
  c = c.replace(/₹\{([a-zA-Z_][\w?.]*)\}/g, (m, expr) => {
    if (expr.includes("formatInr")) return m;
    return `{formatInr(${expr})}`;
  });

  // Labels (INR) -> (₹)
  c = c.replace(/\(INR\)/g, "(₹)");
  c = c.replace(/ \(INR\)/g, " (₹)");

  // Total (INR) header
  c = c.replace(/Total \(INR\)/g, "Total (₹)");

  return c;
}

let changed = 0;
for (const file of walk(root)) {
  if (file.endsWith("formatInr.ts")) continue;
  const before = fs.readFileSync(file, "utf8");
  if (!before.includes("₹") && !before.includes("(INR)")) continue;
  let after = transform(before);
  const needsFormatInr = after.includes("formatInr(") && !before.includes('from "@/lib/formatInr"');
  if (needsFormatInr && !after.includes('from "@/lib/formatInr"')) {
    after = ensureImport(after, file);
  }
  if (after !== before) {
    fs.writeFileSync(file, after);
    changed++;
    console.log(path.relative(root, file));
  }
}
console.log(`Updated ${changed} files`);
