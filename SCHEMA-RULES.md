# Database schema rules — no data loss

These rules ensure **no tables or data are ever dropped** in this project.

## 1. Do not remove tables or columns

- **Never delete** a table definition from `shared/db-schema.ts`.
- **Never remove** a column from any existing table.
- All changes to the schema must be **additive only**: new tables, new columns (nullable or with `DEFAULT`).

## 2. Protected (live) tables

These tables are used by the live app. Do not drop them or remove any of their columns:

| Table             | Used by                    |
|-------------------|----------------------------|
| `gapmc.traders`   | Trader directory, CRUD     |
| `gapmc.invoices`  | Rent/invoices, CRUD        |
| `gapmc.receipts`  | Receipt list/form, CRUD     |
| `gapmc.market_fees` | Market fee, CRUD         |
| `gapmc.agreements`  | Agreements, CRUD         |
| `gapmc.stock_returns` | Returns, create          |
| `gapmc.activity_logs` | Activity log, create   |

## 3. Adding new columns to existing tables

- Prefer **nullable** columns, or columns with a **DEFAULT** value, so existing rows remain valid without backfill.
- Do not change the type of an existing column (e.g. integer → text) without a proper migration that preserves data (e.g. add new column, backfill, then switch usage).

## 4. Before running `db:push`

- Run **`npm run db:backup-data`** to create `db_table_backup.sql` with current data.
- Review the SQL that Drizzle proposes. If it includes `DROP TABLE` or `DROP COLUMN`, **do not proceed** — fix the schema so it only adds tables/columns.
- Use **`npm run db:push-safe`** to create a data backup (`db_table_backup.sql`) and then run `db:push`.

## 5. Push only manages the `gapmc` schema

- `drizzle.config.ts` has **`schemaFilter: "gapmc"`** so that `db:push` only applies changes to the **gapmc** schema.
- Tables in **public** (or other schemas), e.g. `edit_history`, `applications`, `users`, `commodities`, `yards`, etc., are **never** modified or dropped by push.
- If you still see a message like "You're about to delete … table", **do not confirm** — cancel the push and check that `schemaFilter: "gapmc"` is set in `drizzle.config.ts`.

## 6. IOMS and new modules

- New modules (M-01 HRMS, M-02, M-05, etc.) use **new tables** (e.g. `employees`, `trader_licences`, `ioms_receipts`). Existing tables stay unchanged.
- Do not replace existing tables (e.g. `receipts`) with new ones; add parallel tables (e.g. `ioms_receipts`) and keep the old ones.
