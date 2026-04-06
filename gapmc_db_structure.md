# GAPMC Database Structure

All GAPMC tables live in the PostgreSQL schema **`gapmc`**. The application does not create or modify tables in other schemas (e.g. `public`).

---

## Schema: `gapmc`

### 1. `gapmc.traders`

Stores trader (licensee) master data.

| Column               | Type           | Nullable | Description |
|----------------------|----------------|----------|-------------|
| id                   | text           | PK       | Primary key |
| asset_id             | text           | NOT NULL | Asset identifier |
| name                 | text           | NOT NULL | Trader name |
| firm_name            | text           | yes      | Firm/business name |
| type                 | text           | NOT NULL | Individual \| Firm \| Pvt Ltd \| Public Ltd |
| mobile               | text           | NOT NULL | Mobile number |
| phone                | text           | yes      | Phone number |
| email                | text           | NOT NULL | Email |
| residential_address  | text           | yes      | Residential address |
| business_address     | text           | yes      | Business address |
| aadhaar              | text           | NOT NULL | Aadhaar ID |
| pan                  | text           | NOT NULL | PAN |
| gst                  | text           | yes      | GST number |
| epic_voter_id        | text           | yes      | Voter ID |
| bank_name            | text           | yes      | Bank name |
| account_number       | text           | yes      | Account number |
| ifsc_code            | text           | yes      | IFSC code |
| branch_name          | text           | yes      | Branch name |
| yard_id              | integer        | NOT NULL | Yard reference |
| yard_name            | text           | NOT NULL | Yard name |
| premises             | text           | NOT NULL | Premises description |
| premises_type        | text           | NOT NULL | Stall \| Godown \| Shop |
| registration_type    | text           | NOT NULL | Temporary \| Permanent |
| commodities          | jsonb          | NOT NULL | Array of commodity codes/names |
| status               | text           | NOT NULL | Active \| Inactive \| Pending |
| agreement_start      | text           | yes      | Agreement start date |
| agreement_end        | text           | yes      | Agreement end date |
| rent_amount          | double precision | NOT NULL | Rent amount |
| security_deposit     | double precision | NOT NULL | Security deposit |
| created_at           | text           | yes      | Created timestamp |
| updated_at           | text           | yes      | Updated timestamp |

---

### 2. `gapmc.invoices`

Rent/tax invoices for traders.

| Column      | Type             | Nullable | Description |
|-------------|------------------|----------|-------------|
| id          | text             | PK       | Primary key |
| trader_id   | text             | NOT NULL | Trader reference |
| trader_name | text             | NOT NULL | Trader name (denormalized) |
| premises    | text             | NOT NULL | Premises |
| yard        | text             | NOT NULL | Yard name |
| yard_id     | integer          | NOT NULL | Yard ID |
| month       | text             | NOT NULL | Billing month |
| invoice_date| text             | NOT NULL | Invoice date |
| base_rent   | double precision | NOT NULL | Base rent |
| cgst        | double precision | NOT NULL | CGST |
| sgst        | double precision | NOT NULL | SGST |
| interest    | double precision | NOT NULL | Interest |
| total       | double precision | NOT NULL | Total amount |
| tds_applicable | boolean        | NOT NULL | TDS applicable flag |
| tds_amount  | double precision | NOT NULL | TDS amount |
| status      | text             | NOT NULL | Paid \| Pending \| Overdue \| Draft |
| notes       | text             | yes      | Notes |
| created_at  | text             | yes      | Created timestamp |
| updated_at  | text             | yes      | Updated timestamp |

---

### 3. `gapmc.receipts`

Payment receipts (rent, market fee, license fee, etc.).

| Column           | Type             | Nullable | Description |
|------------------|------------------|----------|-------------|
| id               | text             | PK       | Primary key |
| receipt_no       | text             | NOT NULL | Receipt number |
| receipt_date     | text             | NOT NULL | Receipt date |
| type             | text             | NOT NULL | Rent \| Market Fee \| License Fee \| Other |
| trader_id        | text             | NOT NULL | Trader reference |
| trader_name      | text             | NOT NULL | Trader name |
| head             | text             | NOT NULL | Payment head |
| amount           | double precision | NOT NULL | Amount |
| cgst             | double precision | yes      | CGST |
| sgst             | double precision | yes      | SGST |
| interest         | double precision | yes      | Interest |
| security_deposit | double precision | yes      | Security deposit |
| tds_amount       | double precision | yes      | TDS amount |
| total            | double precision | NOT NULL | Total |
| payment_mode     | text             | NOT NULL | Cash \| Cheque \| Online \| Adjustment |
| cheque_no        | text             | yes      | Cheque number |
| cheque_bank      | text             | yes      | Cheque bank |
| cheque_date      | text             | yes      | Cheque date |
| transaction_ref  | text             | yes      | Transaction reference |
| narration        | text             | yes      | Narration |
| yard_id          | integer          | NOT NULL | Yard ID |
| yard_name        | text             | NOT NULL | Yard name |
| issued_by        | text             | NOT NULL | Issued by (user) |
| status           | text             | NOT NULL | Active \| Voided |
| created_at       | text             | yes      | Created timestamp |
| updated_at       | text             | yes      | Updated timestamp |

---

### 4. `gapmc.market_fees`

Market fee entries (import/export).

| Column         | Type             | Nullable | Description |
|----------------|------------------|----------|-------------|
| id             | text             | PK       | Primary key |
| receipt_no     | text             | NOT NULL | Receipt number |
| entry_date     | text             | NOT NULL | Entry date |
| entry_type     | text             | NOT NULL | Import \| Export |
| trader_id      | text             | NOT NULL | Trader reference |
| trader_name    | text             | NOT NULL | Trader name |
| license_no     | text             | NOT NULL | License number |
| address        | text             | yes      | Address |
| gst_pan        | text             | yes      | GST/PAN |
| commodity      | text             | NOT NULL | Commodity |
| commodity_type | text             | NOT NULL | Horticultural \| Non-Horticultural |
| quantity       | double precision | NOT NULL | Quantity |
| unit           | text             | NOT NULL | Kg \| Quintal \| Ton \| Pieces \| Crates |
| rate_per_unit  | double precision | NOT NULL | Rate per unit |
| total_value    | double precision | NOT NULL | Total value |
| market_fee     | double precision | NOT NULL | Market fee amount |
| vehicle_type   | text             | NOT NULL | Vehicle type |
| vehicle_number | text             | NOT NULL | Vehicle number |
| location_id    | integer          | NOT NULL | Location ID |
| location_name  | text             | NOT NULL | Location name |
| payment_mode   | text             | NOT NULL | Cash \| Cheque \| Online |
| created_at     | text             | yes      | Created timestamp |
| updated_at     | text             | yes      | Updated timestamp |

---

### 5. `gapmc.agreements`

Trader agreements (rent, premises, period).

| Column            | Type             | Nullable | Description |
|-------------------|------------------|----------|-------------|
| id                | text             | PK       | Primary key |
| agreement_id      | text             | NOT NULL | Agreement identifier |
| trader_id         | text             | NOT NULL | Trader reference |
| trader_name       | text             | NOT NULL | Trader name |
| premises          | text             | NOT NULL | Premises |
| yard_id           | integer          | NOT NULL | Yard ID |
| yard_name         | text             | NOT NULL | Yard name |
| start_date        | text             | NOT NULL | Start date |
| end_date          | text             | NOT NULL | End date |
| rent_amount       | double precision | NOT NULL | Rent amount |
| security_deposit  | double precision | NOT NULL | Security deposit |
| status            | text             | NOT NULL | Active \| Expiring Soon \| Expired \| Terminated |
| created_at        | text             | yes      | Created timestamp |
| updated_at        | text             | yes      | Updated timestamp |

---

### 6. `gapmc.stock_returns`

Stock return submissions by traders (period-wise, per commodity).

| Column                 | Type             | Nullable | Description |
|------------------------|------------------|----------|-------------|
| id                     | text             | PK       | Primary key |
| trader_id              | text             | NOT NULL | Trader reference |
| trader_name            | text             | NOT NULL | Trader name |
| period                 | text             | NOT NULL | Period (e.g. YYYY-MM) |
| commodity              | text             | NOT NULL | Commodity |
| opening_balance        | double precision | NOT NULL | Opening balance |
| locally_procured       | double precision | NOT NULL | Locally procured |
| purchased_from_trader  | double precision | NOT NULL | Purchased from trader |
| sales                  | double precision | NOT NULL | Sales |
| closing_balance        | double precision | NOT NULL | Closing balance |
| status                 | text             | NOT NULL | Draft \| Submitted |
| created_at             | text             | yes      | Created timestamp |
| updated_at             | text             | yes      | Updated timestamp |

---

### 7. `gapmc.activity_logs`

Audit/activity log entries.

| Column    | Type   | Nullable | Description |
|-----------|--------|----------|-------------|
| id        | text   | PK       | Primary key |
| action    | text   | NOT NULL | Action name |
| module    | text   | NOT NULL | Module (e.g. Rent/Tax, Traders) |
| user      | text   | NOT NULL | User who performed the action |
| timestamp | text   | NOT NULL | Timestamp (ISO) |
| details   | text   | yes      | Optional details |

---

## Dependent / reference data (other schema or database)

GAPMC tables store **denormalized** `yard_id`, `yard_name`, `location_id`, `location_name`, and `asset_id` values. They do **not** define foreign keys to other schemas. If your organisation keeps yards, locations, or assets in another schema or database, those are the **dependent/reference** structures. Below are typical table shapes that match what GAPMC expects by convention.

### Reference tables that may exist elsewhere

These tables are **not** created or modified by GAPMC. They may live in `public` or another schema/database. GAPMC only stores their IDs and names in its own tables.

---

#### Yards / locations (e.g. `public.yards` or `public.locations`)

Used by: `gapmc.traders` (yard_id, yard_name), `gapmc.invoices` (yard_id, yard), `gapmc.receipts` (yard_id, yard_name), `gapmc.agreements` (yard_id, yard_name).  
Market fee uses `location_id` / `location_name`, which may be the same as yards or a separate location list (e.g. yards + check posts).

| Column   | Type    | Nullable | Description |
|----------|---------|----------|-------------|
| id       | integer | PK       | Primary key (matches `yard_id` / `location_id` in gapmc) |
| name     | text    | NOT NULL | Display name (e.g. "Margao Main Yard") |
| code     | text    | yes      | Short code (e.g. MARG, POND) |
| type     | text    | yes      | e.g. Yard \| CheckPost |

**Note:** In the app, yards/locations are currently provided by client-side master data (`client/src/data/yards.ts`). If you move this into a database, the above structure is the expected shape.

---

#### Assets (e.g. `public.assets` or external system)

Used by: `gapmc.traders` (asset_id).  
Stores asset/premises identifiers that may come from an external asset or property system.

| Column   | Type   | Nullable | Description |
|----------|--------|----------|-------------|
| id       | text   | PK       | Asset identifier (matches `asset_id` in gapmc.traders) |
| name     | text   | yes      | Asset/premises description |
| yard_id  | integer| yes      | Link to yard/location if applicable |

---

#### Commodities (optional lookup)

Used by: `gapmc.traders` (commodities jsonb array), `gapmc.market_fees` (commodity, commodity_type), `gapmc.stock_returns` (commodity).  
GAPMC stores commodity names/types as text; a separate commodities master is optional.

| Column         | Type   | Nullable | Description |
|----------------|--------|----------|-------------|
| id             | text/integer | PK  | Primary key |
| name           | text   | NOT NULL | Commodity name (e.g. Vegetables, Fruits) |
| type           | text   | yes      | e.g. Horticultural \| Non-Horticultural |

---

### Summary of GAPMC references to “other” data

| GAPMC column(s)      | Referenced concept   | Where it may live              |
|----------------------|----------------------|--------------------------------|
| yard_id, yard_name   | Yard / market        | public.yards, or other schema  |
| location_id, location_name | Fee location / check post | public.locations or same as yards |
| asset_id             | Asset / premises      | public.assets or external DB  |
| trader_id, trader_name | Trader             | gapmc.traders (within GAPMC)   |

GAPMC does **not** create or alter tables outside the `gapmc` schema. If you use reference tables in another schema or database, ensure `yard_id`/`yard_name`, `location_id`/`location_name`, and `asset_id` values are consistent with those masters.

---

## IOMS extensions (Drizzle `shared/db-schema.ts`)

The live app schema includes additional `gapmc` tables and columns beyond the legacy GAPMC tables documented above, including for example:

| Area | Tables / notes |
|------|----------------|
| M-01 HR | `leave_requests` with `do_user`, `dv_user`, `workflow_revision_count`, `dv_return_remarks`; service book entries |
| M-04 Market | `purchase_transactions` with `parent_transaction_id`, `entry_kind` (Original \| Adjustment) |
| M-09 Dak | `dak_inward`, `dak_outward`, `dak_action_log`, `dak_escalations` |
| M-08 Construction | `land_records`, `fixed_assets`, works, AMC, bills |
| M-10 Admin | `yards` (text `id`, `type` e.g. Yard \| CheckPost), `users`, roles, `system_config`, etc. |

### `gapmc.land_records` (append-only)

Application code does not expose UPDATE/DELETE for land records. For database-level enforcement, run **`npm run db:apply-land-immutable`** (applies `scripts/migrations/002-land-records-immutable.sql`; blocks UPDATE/DELETE on `gapmc.land_records`). Confirm with **`npm run db:verify-schema`**.

---

## Creating the schema

- **Drizzle:** `npm run db:push` (uses `shared/db-schema.ts` and `DATABASE_URL`).
- **SQL script:** `scripts/create-gapmc-schema.sql`; run with `npm run db:create-gapmc` (reads `DATABASE_URL` from `.env`).

Both approaches only create the `gapmc` schema and the tables above; they do not drop or alter existing tables in the database.
