import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: ".env" });

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

async function main() {
  await client.connect();
  try {
    const users = await client.query("SELECT id, email, username, employee_id FROM gapmc.users ORDER BY username NULLS LAST, email");
    const yards = await client.query("SELECT COUNT(*)::int AS c FROM gapmc.yards");
    const yardJoin = await client.query(
      "SELECT COUNT(*)::int AS assigned, SUM(CASE WHEN y.id IS NULL THEN 1 ELSE 0 END)::int AS missing FROM gapmc.user_yards uy LEFT JOIN gapmc.yards y ON y.id = uy.yard_id",
    );
    console.log(
      JSON.stringify(
        {
          yards_count: yards.rows[0].c,
          user_yards_assigned: yardJoin.rows[0].assigned,
          user_yards_missing_yard_rows: yardJoin.rows[0].missing,
          users: users.rows,
        },
        null,
        2,
      ),
    );
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
