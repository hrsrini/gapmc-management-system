/**
 * Clear force_password_change for ADMIN-tier users (exempt from mandatory change).
 * Usage: dotenv -e .env -- tsx scripts/clear-admin-force-password-change.ts
 */
import pg from "pg";

const { Client } = pg;

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error("DATABASE_URL is required.");
    process.exit(1);
  }
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 30000 });
  await client.connect();
  try {
    const r = await client.query(
      `UPDATE gapmc.users u
       SET force_password_change = FALSE
       WHERE EXISTS (
         SELECT 1
         FROM gapmc.user_roles ur
         JOIN gapmc.roles r ON r.id = ur.role_id
         WHERE ur.user_id = u.id AND r.tier = 'ADMIN'
       )
       RETURNING u.email, u.force_password_change`,
    );
    console.log("Cleared force_password_change for ADMIN users:", r.rowCount);
    for (const row of r.rows) {
      console.log(" -", row.email, "force=", row.force_password_change);
    }
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
