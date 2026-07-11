# Intra GAPMC Integration Guide (App 2)

Complete process to integrate **License Manager** licence data into the **GAPMC / IOMS** application (`gapmc` schema) using realtime sync.

Use this file as the single checklist while working in the App 2 codebase and Supabase SQL Editor.

---

## 1. Architecture overview

| System | Schema | Role |
|--------|--------|------|
| License Manager (App 1) | `public` | Source of truth for issued trader licences (number, expiry, commodities, active status) |
| Shared Supabase DB | `postgres` | Same project / same database for both apps |
| GAPMC / IOMS (App 2) | `gapmc` | Owns IOMS workflow, yards, fees, Form BM/BK; receives LM master facts on `trader_licences` |

### Recommended path (no middle table)

```text
License Manager
  └─ public.applications
         │
         │  trigger (YOU create — see §4)
         ▼
  gapmc.trader_licences         ← IOMS working table (UI + APIs)
         │
         ▼
  TraderLicences.tsx
  GET /api/ioms/traders/licences…
```

**Why no `gapmc.licences_cache`?**  
App 2 is the only consumer and already lists/edits via `trader_licences`. A middle cache adds an extra hop without benefit. Sync **directly** from `public.applications` → `gapmc.trader_licences`.

> If `gapmc.licences_cache` was created earlier from License Manager migration `0005`, see **§4.0** to retire it after switching to the direct trigger.

**Rules**

- App 2 must **not** write to `public.applications`.
- App 2 must **not** treat itself as master for market-year expiry or LM commodities once a row is LM-linked.
- App 2 **keeps** ownership of: `yard_id`, `licence_type`, workflow statuses (`Draft` / `Pending` / …), fees, Form BM/BK, blocking.

---

## 2. Prerequisites (verify before coding)

### 2.1 Same database

App 2 `DATABASE_URL` / Supabase project must be the **same** as License Manager.

- Database name: `postgres`
- App 2 schema: `gapmc`
- LM schema: `public`

### 2.2 Confirm LM source table

```sql
SELECT count(*) AS issued
FROM public.applications
WHERE license_number IS NOT NULL
  AND status IN ('License Issued', 'License Expired');

SELECT license_number, status, trader_name, firm_name,
       (expiry_date AT TIME ZONE 'UTC')::date AS expiry_day,
       commodities
FROM public.applications
WHERE license_number IS NOT NULL
ORDER BY license_number DESC
LIMIT 10;
```

### 2.3 Confirm App 2 table

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'gapmc' AND table_name = 'trader_licences'
ORDER BY ordinal_position;
```

Match key: **`trader_licences.licence_no` = `applications.license_number`**.

---

## 3. Field mapping

### 3.1 Sync from LM → App 2

| `public.applications` | `gapmc.trader_licences` | Action |
|-----------------------|-------------------------|--------|
| `license_number` | `licence_no` | Join / match key |
| `firm_name` | `firm_name` | Update on sync |
| `trader_name` | `contact_name` | Fill if App 2 value empty |
| `issue_date` | `valid_from` | Store as `YYYY-MM-DD` text |
| `expiry_date` | `valid_to` | Store as `YYYY-MM-DD` text |
| `commodities` | `commodities` (**new**) | jsonb array |
| `status` | `lm_status` (**new**) | LM raw status |
| *(derived)* | `lm_is_active` (**new**) | See active rule below |
| `license_class` | `lm_license_class` (**new**) | Class A/B/C — **not** `licence_type` |
| `updated_at` / now() | `lm_synced_at` (**new**) | Last sync time |

**LM active rule (for `lm_is_active`):**

```text
status = 'License Issued'
AND superseded_by_license_number IS NULL
AND (
  expiry_date IS NULL
  OR (expiry_date AT TIME ZONE 'UTC')::date
     >= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date
)
```

### 3.2 Do NOT overwrite from LM

| App 2 column | Reason |
|--------------|--------|
| `id` | App 2 PK |
| `yard_id` | App 2 yard FK |
| `licence_type` | Associated / Functionary / Hamali / Weighman / AssistantTrader — **different** from LM Class A/B/C |
| `status` when Draft, Pending, Query, Rejected, Blocked | IOMS workflow |
| `is_blocked`, `block_reason` | App 2 enforcement |
| Fees, receipts, Form BM/BK, workflow users, serials | App 2 only |
| `aadhaar_token`, `pan`, `gstin`, `mobile`, `email`, `address` | Keep App 2 unless you later choose LM as source |

### 3.3 Status mapping rules

Only when App 2 `status` is already `Active` or `Expired`:

| LM `lm_is_active` | App 2 `is_blocked` | Resulting App 2 `status` |
|-------------------|--------------------|---------------------------|
| true | false | `Active` |
| false | false | `Expired` |
| any | true | leave as `Blocked` (do not change) |

If App 2 `status` is `Draft` | `Pending` | `Query` | `Rejected` | `Blocked`:

- Still update `valid_to`, `commodities`, `lm_*`
- **Do not** change `status`

---

## 4. SQL to run (Step-by-step)

Run in Supabase SQL Editor (or an App 2 migration). Prefer running as a DB role that can create triggers on `public.applications`.

### 4.0 Retire optional `licences_cache` (if it exists)

An earlier License Manager migration may have created `gapmc.licences_cache` and triggers into it. For the **direct** path, remove that middle layer **after** (or when) installing §4.2:

```sql
-- Drop LM → cache triggers (names from migration 0005)
DROP TRIGGER IF EXISTS trg_sync_licence_to_gapmc ON public.applications;
DROP TRIGGER IF EXISTS trg_sync_licence_to_gapmc_delete ON public.applications;
DROP FUNCTION IF EXISTS gapmc.sync_licence_from_applications();

-- Optional: drop any cache → trader_licences trigger if you created one earlier
DROP TRIGGER IF EXISTS trg_cache_to_trader_licences ON gapmc.licences_cache;
DROP FUNCTION IF EXISTS gapmc.sync_trader_licence_from_cache();

-- Optional: remove cache table once unused
-- DROP TABLE IF EXISTS gapmc.licences_cache;
```

You may keep the table temporarily for comparison; it is **not** required for App 2.

### 4.1 Add columns on `trader_licences`

```sql
ALTER TABLE gapmc.trader_licences
  ADD COLUMN IF NOT EXISTS commodities jsonb,
  ADD COLUMN IF NOT EXISTS lm_status text,
  ADD COLUMN IF NOT EXISTS lm_is_active boolean,
  ADD COLUMN IF NOT EXISTS lm_license_class text,
  ADD COLUMN IF NOT EXISTS lm_synced_at timestamptz;

CREATE INDEX IF NOT EXISTS trader_licences_lm_active_idx
  ON gapmc.trader_licences (lm_is_active);

CREATE INDEX IF NOT EXISTS trader_licences_licence_no_idx
  ON gapmc.trader_licences (licence_no);
```

### 4.2 Sync function + trigger (direct: applications → trader_licences)

```sql
CREATE OR REPLACE FUNCTION gapmc.sync_trader_licence_from_applications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, gapmc
AS $fn$
DECLARE
  v_active boolean;
  v_valid_to text;
  v_valid_from text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Do not delete IOMS rows; only clear LM link markers if desired
    IF OLD.license_number IS NOT NULL THEN
      UPDATE gapmc.trader_licences t
      SET
        lm_is_active = false,
        lm_status = 'License Deleted',
        lm_synced_at = now()
      WHERE t.licence_no = OLD.license_number;
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.license_number IS NULL THEN
    RETURN NEW;
  END IF;

  v_active :=
    NEW.status = 'License Issued'
    AND NEW.superseded_by_license_number IS NULL
    AND (
      NEW.expiry_date IS NULL
      OR (NEW.expiry_date AT TIME ZONE 'UTC')::date
         >= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date
    );

  v_valid_to := CASE
    WHEN NEW.expiry_date IS NULL THEN NULL
    ELSE to_char((NEW.expiry_date AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD')
  END;

  v_valid_from := CASE
    WHEN NEW.issue_date IS NULL THEN NULL
    ELSE to_char((NEW.issue_date AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD')
  END;

  UPDATE gapmc.trader_licences t
  SET
    firm_name = COALESCE(NEW.firm_name, t.firm_name),
    contact_name = COALESCE(NULLIF(trim(t.contact_name), ''), NEW.trader_name, t.contact_name),
    valid_to = COALESCE(v_valid_to, t.valid_to),
    valid_from = COALESCE(v_valid_from, t.valid_from),
    commodities = CASE
      WHEN NEW.commodities IS NULL THEN t.commodities
      ELSE NEW.commodities::jsonb
    END,
    lm_status = NEW.status,
    lm_is_active = v_active,
    lm_license_class = NEW.license_class,
    lm_synced_at = now(),
    status = CASE
      WHEN COALESCE(t.is_blocked, false) THEN t.status
      WHEN t.status IN ('Active', 'Expired') AND v_active THEN 'Active'
      WHEN t.status IN ('Active', 'Expired') AND NOT v_active THEN 'Expired'
      ELSE t.status
    END,
    updated_at = to_char(timezone('Asia/Kolkata', now()), 'YYYY-MM-DD"T"HH24:MI:SS')
  WHERE t.licence_no = NEW.license_number;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_sync_trader_licence_from_applications ON public.applications;
DROP TRIGGER IF EXISTS trg_sync_trader_licence_from_applications_del ON public.applications;

CREATE TRIGGER trg_sync_trader_licence_from_applications
AFTER INSERT OR UPDATE OF
  license_number,
  trader_name,
  firm_name,
  license_class,
  commodities,
  commodity,
  status,
  issue_date,
  expiry_date,
  superseded_by_license_number,
  updated_at
ON public.applications
FOR EACH ROW
EXECUTE FUNCTION gapmc.sync_trader_licence_from_applications();

CREATE TRIGGER trg_sync_trader_licence_from_applications_del
AFTER DELETE ON public.applications
FOR EACH ROW
EXECUTE FUNCTION gapmc.sync_trader_licence_from_applications();
```

> If App 2 uses a different `updated_at` string format, change the `updated_at = …` expression to match existing rows.  
> If `commodities` is already `jsonb` in `applications`, you can assign `NEW.commodities` without `::jsonb`.

### 4.3 One-time backfill

```sql
UPDATE gapmc.trader_licences t
SET
  firm_name = COALESCE(a.firm_name, t.firm_name),
  contact_name = COALESCE(NULLIF(trim(t.contact_name), ''), a.trader_name, t.contact_name),
  valid_to = COALESCE(
    to_char((a.expiry_date AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD'),
    t.valid_to
  ),
  valid_from = COALESCE(
    to_char((a.issue_date AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD'),
    t.valid_from
  ),
  commodities = COALESCE(a.commodities::jsonb, t.commodities),
  lm_status = a.status,
  lm_is_active = (
    a.status = 'License Issued'
    AND a.superseded_by_license_number IS NULL
    AND (
      a.expiry_date IS NULL
      OR (a.expiry_date AT TIME ZONE 'UTC')::date
         >= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date
    )
  ),
  lm_license_class = a.license_class,
  lm_synced_at = now(),
  status = CASE
    WHEN COALESCE(t.is_blocked, false) THEN t.status
    WHEN t.status IN ('Active', 'Expired')
      AND a.status = 'License Issued'
      AND a.superseded_by_license_number IS NULL
      AND (
        a.expiry_date IS NULL
        OR (a.expiry_date AT TIME ZONE 'UTC')::date
           >= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date
      )
      THEN 'Active'
    WHEN t.status IN ('Active', 'Expired') THEN 'Expired'
    ELSE t.status
  END
FROM public.applications a
WHERE t.licence_no = a.license_number
  AND a.license_number IS NOT NULL;
```

### 4.4 Gap reports (fix mismatches)

```sql
-- In App 2 but not in LM
SELECT t.licence_no, t.status, t.licence_type, t.firm_name
FROM gapmc.trader_licences t
LEFT JOIN public.applications a ON a.license_number = t.licence_no
WHERE a.license_number IS NULL
ORDER BY t.licence_no;

-- In LM (issued/expired) but not in App 2
SELECT a.license_number, a.license_class, a.status, a.firm_name
FROM public.applications a
LEFT JOIN gapmc.trader_licences t ON t.licence_no = a.license_number
WHERE a.license_number IS NOT NULL
  AND a.status IN ('License Issued', 'License Expired')
  AND t.licence_no IS NULL
ORDER BY a.license_number;

-- Linked sample
SELECT t.licence_no, t.status, t.valid_to, t.lm_is_active, t.lm_status, t.commodities
FROM gapmc.trader_licences t
WHERE t.lm_synced_at IS NOT NULL
ORDER BY t.lm_synced_at DESC
LIMIT 20;
```

**Policy for gaps**

- App 2-only rows (Hamali / Weighman / etc. with no LM number): leave as-is; `lm_*` stays null; do not gate on `lm_is_active`.
- LM-only rows (`License Issued` / `License Expired` with a `license_number`): **auto-insert** into `trader_licences` via migration `059` / trigger (yard resolved from `applications.yard`; `licence_type` defaults to `Associated`; unknown yards → Margao Main).
- Number format: `licence_no` must equal LM `license_number` (e.g. `10256`).
- Re-run import: `npm run db:apply-m02-lm-trader-licence-import`

### 4.5 Realtime publication

App 2 UI should listen to **`trader_licences`** (updated by the direct trigger):

```sql
DO $pub$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE gapmc.trader_licences;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN
    RAISE NOTICE 'supabase_realtime publication not found';
END;
$pub$;
```

### 4.6 Grants / RLS

```sql
GRANT USAGE ON SCHEMA public TO authenticated;  -- only if App 2 must SELECT applications (prefer not)
-- Prefer: App 2 never reads public.applications; only trader_licences after sync.

GRANT USAGE ON SCHEMA gapmc TO authenticated;
GRANT SELECT, UPDATE ON gapmc.trader_licences TO authenticated;
```

Tighten RLS as needed. Do **not** grant App 2 end users UPDATE on `public.applications`.

---

## 5. App 2 code changes

### 5.1 Drizzle schema (`shared/db-schema.ts`)

On `traderLicences = gapmc.table("trader_licences", { … })` add:

```ts
commodities: jsonb("commodities").$type<string[] | null>(),
lmStatus: text("lm_status"),
lmIsActive: boolean("lm_is_active"),
lmLicenseClass: text("lm_license_class"),
lmSyncedAt: timestamp("lm_synced_at", { withTimezone: true }),
// Match timestamp helpers already used in this file if different.
```

### 5.2 List / detail API (`server/routes-traders-assets.ts`)

**Keep**

- Table: `gapmc.trader_licences`
- Endpoints:
  - `GET /api/ioms/traders/licences?paged=1&page=&pageSize=&q=&sort=&sortDir=`
  - filters: `allYards`, `yardId`, `status`, `licenceTypes`
  - `GET /api/ioms/traders/licences/:id`
- Yard scoping logic unchanged

**Change**

- Include in SELECT / response DTO:
  - `commodities`, `lmStatus`, `lmIsActive`, `lmLicenseClass`, `lmSyncedAt`
  - existing `validFrom`, `validTo` (LM-fed when linked)

Optional filters:

- `lmLinked=1` → `lm_synced_at IS NOT NULL`
- `lmActive=1` → `lm_is_active = true`

### 5.3 Business operation guards

```ts
function assertLmLicenceAllowsOperation(
  licence: {
    lmSyncedAt?: string | Date | null;
    lmIsActive?: boolean | null;
    commodities?: string[] | null;
    isBlocked?: boolean | null;
    status?: string | null;
  },
  commodity?: string,
) {
  if (licence.isBlocked || licence.status === "Blocked") {
    throw new Error("Licence is blocked");
  }

  // Only enforce LM rules when the row is linked to License Manager
  if (licence.lmSyncedAt == null) {
    return; // App 2-only licence types — use App 2 status only
  }

  if (licence.lmIsActive !== true) {
    throw new Error("Licence is not active in License Manager");
  }

  if (commodity && Array.isArray(licence.commodities) && licence.commodities.length > 0) {
    if (!licence.commodities.includes(commodity)) {
      throw new Error("Commodity not allowed on this licence");
    }
  }
}
```

Call from write routes that depend on licence validity.

### 5.4 UI (`TraderLicences.tsx` and detail/edit)

1. Show `validTo` as registration valid-upto (store `YYYY-MM-DD`, display `DD-MM-YYYY` if needed).
2. Show `commodities` when present.
3. Badge when `lmSyncedAt` set: “LM linked” / Class from `lmLicenseClass`.
4. When `lmSyncedAt` is set, make **read-only**: `validFrom`, `validTo`, `commodities`.
5. Do **not** bind `licenceType` to `lmLicenseClass`.
6. Optional Realtime:

```ts
useEffect(() => {
  const channel = supabase
    .channel("trader-licences")
    .on(
      "postgres_changes",
      { event: "*", schema: "gapmc", table: "trader_licences" },
      () => {
        refetch();
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}, [refetch]);
```

### 5.5 Creating / editing licences in App 2

| Scenario | Behaviour |
|----------|-----------|
| New IOMS-only type (Hamali, etc.) | Create in `trader_licences` as today; `lm_*` null |
| Trader licence that exists in LM | Link by `licence_no`; do not invent expiry/commodities |
| Edit linked row | Allow App 2 fields; block edits to LM-owned expiry/commodities |

**Do** auto-create `trader_licences` from LM applications with an issued/expired `license_number` (migration `059` + trigger INSERT). Yard is resolved from `applications.yard`; `licence_type` defaults to `Associated`. IOMS-only types (Hamali, etc.) remain App 2-created when CRUD is re-enabled.

---

## 6. End-to-end test plan

1. **Backfill check**  
   Known LM number (e.g. `10256`): App 2 has `valid_to` = `2027-03-31`, `lm_is_active = true`, commodities if present in LM.

2. **Trigger check**  
   In License Manager, update that licence (status / expiry / commodities).  
   Within seconds, `trader_licences.lm_synced_at` and fields update. List refreshes if Realtime is wired.

3. **Expiry**  
   When LM becomes inactive, App 2 `Active` → `Expired` (unless blocked).

4. **Workflow safety**  
   App 2 row `Pending` + LM update → status stays `Pending`; `valid_to` / `lm_*` still update.

5. **Ops guard**  
   LM-linked inactive → write rejected. Wrong commodity → rejected. No `lmSyncedAt` → LM guards skipped.

6. **Yard scoping**  
   Non-admin list still respects `yard_id IN (…)`.

---

## 7. Operational maintenance

| Task | Frequency | Action |
|------|-----------|--------|
| Reconcile drift | Weekly / nightly | Re-run backfill `UPDATE … FROM public.applications` (§4.3) |
| Gap report | After LM bulk import | Run §4.4 |
| Number normalization | As needed | Align `licence_no` to LM `license_number` |

---

## 8. License Manager side

| Item | Needed for direct path? |
|------|-------------------------|
| Normal issue / renew / expire writing `public.applications` | **Yes** (already) |
| `gapmc.licences_cache` + migration `0005` | **No** — retired by `0006`; do not re-apply `0005` after `0006` |
| Shared DB trigger on `public.applications` → `trader_licences` | **Yes** — run below |

In the **License Manager** repo (same `DATABASE_URL`):

```bash
npm run db:apply-gapmc-trader-sync
```

This applies `migrations/0006_gapmc_direct_trader_licence_sync.sql` (retire cache, add LM columns, direct trigger, backfill, Realtime).

No License Manager **application code** change is required for sync; the DB trigger is enough.

---

## 9. Master checklist (App 2)

### Database

- [ ] Verified LM rows in `public.applications` with `license_number`
- [ ] (§4.0) Retired `licences_cache` triggers if previously installed
- [ ] Added `commodities`, `lm_status`, `lm_is_active`, `lm_license_class`, `lm_synced_at`
- [ ] Created `sync_trader_licence_from_applications` + triggers on `public.applications`
- [ ] Ran backfill from `public.applications`
- [ ] Ran gap reports; fixed `licence_no` mismatches where needed
- [ ] Added `trader_licences` to Realtime publication
- [ ] Grants/RLS reviewed

### Code

- [ ] Drizzle schema updated
- [ ] List/detail APIs return new fields
- [ ] Write APIs call `assertLmLicenceAllowsOperation` when LM-linked
- [ ] UI shows expiry, commodities, LM class badge
- [ ] UI read-only for LM-owned fields when linked
- [ ] Realtime refetch on list (optional)
- [ ] `licence_type` never overwritten by `lm_license_class`

### Tests

- [ ] Linked licence shows correct `valid_to` (31 Mar market year)
- [ ] LM change syncs directly to App 2
- [ ] Pending workflow status preserved
- [ ] Blocked status preserved
- [ ] Commodity / inactive guards work
- [ ] Yard filters still work

---

## 10. Quick reference — App 2 load path

| Layer | Detail |
|-------|--------|
| UI | `TraderLicences.tsx` |
| API | `GET /api/ioms/traders/licences?paged=1&…` |
| Detail | `GET /api/ioms/traders/licences/:id` |
| Server | `server/routes-traders-assets.ts` |
| Table | `gapmc.trader_licences` (`traderLicences` in Drizzle) |
| LM sync source | `public.applications` (direct trigger — **no** `licences_cache`) |

---

## 11. Ownership

| Concern | Owner |
|---------|--------|
| Issue / renew / expire / commodities in LM | License Manager |
| Trigger `applications` → `trader_licences` | Shared DB / App 2 integration (this guide) |
| IOMS workflow, yards, fees, Form BM/BK | App 2 / GAPMC |

---

*Document version: 2.0 — direct sync `public.applications` → `gapmc.trader_licences`. Middle table `gapmc.licences_cache` is optional and not required.*
