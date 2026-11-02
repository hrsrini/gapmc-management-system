/**
 * Replace U+2014 em dash in employee_documents.file_name (breaks Content-Disposition).
 * Usage: dotenv -e .env -- tsx scripts/heal-emdash-doc-filenames.ts
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../server/db";
import { employeeDocuments } from "@shared/db-schema";

const EM = "\u2014";

async function main() {
  const rows = await db
    .select({ id: employeeDocuments.id, fileName: employeeDocuments.fileName })
    .from(employeeDocuments)
    .where(sql`${employeeDocuments.fileName} like ${"%" + EM + "%"}`);
  console.log(`Found ${rows.length} row(s) with em dash`);
  for (const r of rows) {
    const fixed = String(r.fileName ?? "").split(EM).join("-");
    await db.update(employeeDocuments).set({ fileName: fixed }).where(sql`${employeeDocuments.id} = ${r.id}`);
    console.log(`fixed ${r.id}: ${fixed}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
