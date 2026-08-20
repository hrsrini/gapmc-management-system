import "dotenv/config";
import { db } from "../server/db";
import { hrHolidays } from "../shared/db-schema";
import { nanoid } from "nanoid";
import fs from "fs";
import path from "path";
import { and, eq } from "drizzle-orm";

type HolidaySeed = {
  date: string; // YYYY-MM-DD
  name: string;
  category: "Public" | "Special" | "Restricted" | "AdHoc" | string;
  isTentative?: boolean;
};

async function seed() {
  const seedPath = path.join(process.cwd(), "scripts", "seed-2026-holidays.json");
  const raw = fs.readFileSync(seedPath, "utf-8");
  const parsed = JSON.parse(raw) as { holidays: HolidaySeed[] };
  const holidays = Array.isArray(parsed.holidays) ? parsed.holidays : [];

  if (!holidays.length) {
    console.log("No holidays found in seed-2026-holidays.json; skipping.");
    return;
  }

  const now = new Date().toISOString();
  let inserted = 0;
  let skipped = 0;

  for (const h of holidays) {
    const date = String(h.date ?? "").trim();
    const name = String(h.name ?? "").trim();
    const category = String(h.category ?? "").trim();
    if (!date || !name || !category) continue;
    const year = Number(date.slice(0, 4));

    // Idempotent insert: no unique constraint on (year,date,name), so we check first.
    const [existing] = await db
      .select()
      .from(hrHolidays)
      .where(and(eq(hrHolidays.year, year), eq(hrHolidays.date, date), eq(hrHolidays.name, name), eq(hrHolidays.category, category)))
      .limit(1);

    if (existing) {
      skipped++;
      continue;
    }

    await db.insert(hrHolidays).values({
      id: nanoid(),
      year,
      date,
      name,
      category,
      isTentative: h.isTentative === true,
      createdAt: now,
      updatedAt: now,
    });
    inserted++;
  }

  console.log(`seed-hr-holidays-2026: inserted=${inserted}, skipped=${skipped}`);
}

seed()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("seed-hr-holidays-2026 failed:", e);
    process.exit(1);
  });

