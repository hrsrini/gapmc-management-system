/**
 * Seed leave sanction-order notification recipients for UAT (idempotent).
 *
 * Sets:
 *  - yards.email for all locations missing email
 *  - system_config leave_ho_section_emails_json (Accounts / Admin / Inspection)
 *
 * Email source (first match):
 *  1) LEAVE_UAT_NOTIFY_EMAIL env
 *  2) NOTIFY_EMAIL_TO env
 *  3) SMTP_USER / smtp_user from system_config
 *
 * Usage: npm run db:seed-leave-notify-uat
 */
import pg from "pg";

const HO_SECTIONS = ["Accounts Section", "Admin Section", "Inspection Section"] as const;

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    let email =
      process.env.LEAVE_UAT_NOTIFY_EMAIL?.trim() ||
      process.env.NOTIFY_EMAIL_TO?.trim() ||
      process.env.SMTP_USER?.trim() ||
      "";

    if (!email.includes("@")) {
      const cfg = await client.query<{ value: string }>(
        `select value from gapmc.system_config where key = 'smtp_user' limit 1`,
      );
      email = (cfg.rows[0]?.value ?? "").trim();
    }

    if (!email.includes("@")) {
      console.error(
        "No UAT email found. Set LEAVE_UAT_NOTIFY_EMAIL (or NOTIFY_EMAIL_TO / SMTP_USER) and re-run.",
      );
      process.exit(1);
    }

    const yards = await client.query(
      `update gapmc.yards
       set email = $1
       where email is null or btrim(email) = ''
       returning code, name`,
      [email],
    );

    const map: Record<string, string> = {};
    for (const section of HO_SECTIONS) map[section] = email;
    const json = JSON.stringify(map);

    await client.query(
      `insert into gapmc.system_config (key, value, updated_by, updated_at)
       values ('leave_ho_section_emails_json', $1, 'seed-leave-notify-uat', $2)
       on conflict (key) do update
       set value = excluded.value,
           updated_by = excluded.updated_by,
           updated_at = excluded.updated_at`,
      [json, new Date().toISOString()],
    );

    console.log(`UAT notify email: ${email}`);
    console.log(`Yards updated (email was empty): ${yards.rowCount ?? 0}`);
    for (const r of yards.rows) {
      console.log(`  - ${r.code} ${r.name}`);
    }
    console.log(`HO section map: ${json}`);
    console.log("Done. Re-run: npm run go-live:leave-check");
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
