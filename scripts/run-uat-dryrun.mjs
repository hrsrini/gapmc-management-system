import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: ".env" });

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

const toInt = (v) => Number.parseInt(v ?? "0", 10);

async function main() {
  await client.connect();
  try {
    const admin = await client.query(
      "SELECT id, employee_id FROM gapmc.users WHERE username = 'admin'",
    );

    if (admin.rowCount !== 1) {
      throw new Error(`Expected exactly one admin user, found ${admin.rowCount}`);
    }

    const adminId = admin.rows[0].id;
    const adminEmployeeId = admin.rows[0].employee_id ?? null;

    const q = await client.query(
      `SELECT
        (SELECT COUNT(*) FROM gapmc.users) AS users_total,
        (SELECT COUNT(*) FROM gapmc.users WHERE id = $1) AS users_kept,
        (SELECT COUNT(*) FROM gapmc.users WHERE id <> $1) AS users_to_delete,
        (SELECT COUNT(*) FROM gapmc.user_roles) AS user_roles_total,
        (SELECT COUNT(*) FROM gapmc.user_roles WHERE user_id = $1) AS user_roles_kept,
        (SELECT COUNT(*) FROM gapmc.user_roles WHERE user_id <> $1) AS user_roles_to_delete,
        (SELECT COUNT(*) FROM gapmc.user_yards) AS user_yards_total,
        (SELECT COUNT(*) FROM gapmc.user_yards WHERE user_id = $1) AS user_yards_kept,
        (SELECT COUNT(*) FROM gapmc.user_yards WHERE user_id <> $1) AS user_yards_to_delete,
        (SELECT COUNT(*) FROM gapmc.roles) AS roles_kept,
        (SELECT COUNT(*) FROM gapmc.permissions) AS permissions_kept,
        (SELECT COUNT(*) FROM gapmc.role_permissions) AS role_permissions_kept,
        (SELECT COUNT(*) FROM gapmc.employees) AS employees_total,
        (SELECT COUNT(*) FROM gapmc.employees WHERE id = $2) AS employees_kept,
        (SELECT COUNT(*) FROM gapmc.employees WHERE ($2 IS NULL) OR id <> $2) AS employees_to_delete`,
      [adminId, adminEmployeeId],
    );

    const s = q.rows[0];
    console.log(
      JSON.stringify(
        {
          adminId,
          adminEmployeeId,
          summary: {
            users_total: toInt(s.users_total),
            users_kept: toInt(s.users_kept),
            users_to_delete: toInt(s.users_to_delete),
            user_roles_total: toInt(s.user_roles_total),
            user_roles_kept: toInt(s.user_roles_kept),
            user_roles_to_delete: toInt(s.user_roles_to_delete),
            user_yards_total: toInt(s.user_yards_total),
            user_yards_kept: toInt(s.user_yards_kept),
            user_yards_to_delete: toInt(s.user_yards_to_delete),
            roles_kept: toInt(s.roles_kept),
            permissions_kept: toInt(s.permissions_kept),
            role_permissions_kept: toInt(s.role_permissions_kept),
            employees_total: toInt(s.employees_total),
            employees_kept: toInt(s.employees_kept),
            employees_to_delete: toInt(s.employees_to_delete),
          },
        },
        null,
        2,
      ),
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
