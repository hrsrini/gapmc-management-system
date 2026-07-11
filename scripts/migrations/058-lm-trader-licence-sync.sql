-- M-02: License Manager (App 1) → GAPMC trader_licences direct sync
-- Source: docs/license_intra_integration.md §4

-- 4.0 Retire optional licences_cache middle layer (if previously installed)
DROP TRIGGER IF EXISTS trg_sync_licence_to_gapmc ON public.applications;
DROP TRIGGER IF EXISTS trg_sync_licence_to_gapmc_delete ON public.applications;
DROP FUNCTION IF EXISTS gapmc.sync_licence_from_applications();

DO $retire_cache$
BEGIN
  IF to_regclass('gapmc.licences_cache') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_cache_to_trader_licences ON gapmc.licences_cache;
  END IF;
  DROP FUNCTION IF EXISTS gapmc.sync_trader_licence_from_cache();
END;
$retire_cache$;

-- 4.1 Add LM columns on trader_licences
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

-- 4.2 Sync function + triggers (only if public.applications exists)
DO $setup$
BEGIN
  IF to_regclass('public.applications') IS NULL THEN
    RAISE NOTICE 'public.applications not found — columns added; skip trigger until License Manager schema is present';
    RETURN;
  END IF;

  EXECUTE $fn$
    CREATE OR REPLACE FUNCTION gapmc.sync_trader_licence_from_applications()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, gapmc
    AS $body$
    DECLARE
      v_active boolean;
      v_valid_to text;
      v_valid_from text;
    BEGIN
      IF TG_OP = 'DELETE' THEN
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
    $body$;
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

  -- 4.3 One-time backfill
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

  RAISE NOTICE 'LM → trader_licences sync trigger + backfill applied';
END;
$setup$;

-- 4.5 Realtime publication (best-effort)
DO $pub$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE gapmc.trader_licences;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN
    RAISE NOTICE 'supabase_realtime publication not found';
END;
$pub$;
