import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: ".env" });

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

async function main() {
  await client.connect();
  try {
    await client.query("BEGIN");

    const admin = await client.query(
      "SELECT id, employee_id FROM gapmc.users WHERE username = 'admin' LIMIT 1",
    );
    if (admin.rowCount !== 1) {
      throw new Error(`Expected admin user username=admin, found ${admin.rowCount}`);
    }
    const adminId = admin.rows[0].id;
    const adminEmployeeId = admin.rows[0].employee_id ?? null;

    const yards = await client.query(
      "SELECT id FROM gapmc.yards WHERE is_active IS DISTINCT FROM false ORDER BY name",
    );
    if (yards.rowCount === 0) {
      throw new Error("No active yards found in gapmc.yards");
    }

    // Replace yard scope for admin with current yard ids
    await client.query("DELETE FROM gapmc.user_yards WHERE user_id = $1", [adminId]);
    for (const y of yards.rows) {
      await client.query(
        "INSERT INTO gapmc.user_yards (user_id, yard_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [adminId, y.id],
      );
    }

    // Ensure admin's employee record yardId points to a valid yard (first active yard)
    if (adminEmployeeId) {
      await client.query(
        "UPDATE gapmc.employees SET yard_id = $1 WHERE id = $2",
        [yards.rows[0].id, adminEmployeeId],
      );
    }

    await client.query("COMMIT");
    console.log(
      JSON.stringify(
        {
          fixed_user_id: adminId,
          fixed_employee_id: adminEmployeeId,
          yards_assigned: yards.rowCount,
        },
        null,
        2,
      ),
    );
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback errors
    }
    throw e;
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
