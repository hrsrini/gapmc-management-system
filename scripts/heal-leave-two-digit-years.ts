/**
 * Heal leave_requests dates where HTML date inputs stored years 00–99 as 00xx (e.g. 0026 → 2026).
 * from_date / to_date / duty_date_for_spl_h / applied_at are stored as text YYYY-MM-DD.
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";

const result = await db.execute(sql`
  WITH bad AS (
    SELECT id
    FROM gapmc.leave_requests
    WHERE (
      from_date ~ '^[0-9]{4}-'
      AND SUBSTRING(from_date FROM 1 FOR 4)::int BETWEEN 0 AND 99
    )
    OR (
      to_date ~ '^[0-9]{4}-'
      AND SUBSTRING(to_date FROM 1 FOR 4)::int BETWEEN 0 AND 99
    )
    OR (
      duty_date_for_spl_h IS NOT NULL
      AND duty_date_for_spl_h ~ '^[0-9]{4}-'
      AND SUBSTRING(duty_date_for_spl_h FROM 1 FOR 4)::int BETWEEN 0 AND 99
    )
    OR (
      applied_at IS NOT NULL
      AND applied_at ~ '^[0-9]{4}-'
      AND SUBSTRING(applied_at FROM 1 FOR 4)::int BETWEEN 0 AND 99
    )
  )
  UPDATE gapmc.leave_requests lr
  SET
    from_date = CASE
      WHEN lr.from_date ~ '^[0-9]{4}-'
        AND SUBSTRING(lr.from_date FROM 1 FOR 4)::int BETWEEN 0 AND 99
      THEN LPAD((SUBSTRING(lr.from_date FROM 1 FOR 4)::int + 2000)::text, 4, '0')
        || SUBSTRING(lr.from_date FROM 5)
      ELSE lr.from_date
    END,
    to_date = CASE
      WHEN lr.to_date ~ '^[0-9]{4}-'
        AND SUBSTRING(lr.to_date FROM 1 FOR 4)::int BETWEEN 0 AND 99
      THEN LPAD((SUBSTRING(lr.to_date FROM 1 FOR 4)::int + 2000)::text, 4, '0')
        || SUBSTRING(lr.to_date FROM 5)
      ELSE lr.to_date
    END,
    duty_date_for_spl_h = CASE
      WHEN lr.duty_date_for_spl_h IS NOT NULL
        AND lr.duty_date_for_spl_h ~ '^[0-9]{4}-'
        AND SUBSTRING(lr.duty_date_for_spl_h FROM 1 FOR 4)::int BETWEEN 0 AND 99
      THEN LPAD((SUBSTRING(lr.duty_date_for_spl_h FROM 1 FOR 4)::int + 2000)::text, 4, '0')
        || SUBSTRING(lr.duty_date_for_spl_h FROM 5)
      ELSE lr.duty_date_for_spl_h
    END,
    applied_at = CASE
      WHEN lr.applied_at IS NOT NULL
        AND lr.applied_at ~ '^[0-9]{4}-'
        AND SUBSTRING(lr.applied_at FROM 1 FOR 4)::int BETWEEN 0 AND 99
      THEN LPAD((SUBSTRING(lr.applied_at FROM 1 FOR 4)::int + 2000)::text, 4, '0')
        || SUBSTRING(lr.applied_at FROM 5)
      ELSE lr.applied_at
    END
  FROM bad
  WHERE lr.id = bad.id
  RETURNING lr.id, lr.from_date, lr.to_date
`);

console.log("Healed rows:", JSON.stringify((result as { rows?: unknown }).rows ?? result, null, 2));
process.exit(0);
