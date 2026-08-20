import "dotenv/config";
import { pool } from "../server/db";

async function main() {
  const r1 = await pool.query(`select to_regclass('gapmc.hr_holidays') as regclass`);
  console.log("gapmc.hr_holidays:", r1.rows[0]?.regclass ?? null);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

