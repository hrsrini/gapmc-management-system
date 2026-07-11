-- M-02: Complete LM → trader_licences data flow (INSERT + yard resolve + backfill)
-- Extends 058: previously UPDATE-only matched existing App 2 rows; after purge nothing synced.

-- Resolve LM applications.yard text → gapmc.yards.id
CREATE OR REPLACE FUNCTION gapmc.resolve_yard_id_from_lm_yard(p_yard text)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = gapmc, public
AS $fn$
DECLARE
  v text := lower(btrim(coalesce(p_yard, '')));
  v_id text;
BEGIN
  IF v = '' OR v IN ('imported - n/a', 'n/a', 'na', 'unknown', 'null') THEN
    SELECT y.id INTO v_id FROM gapmc.yards y WHERE y.code = 'Y-MAR' LIMIT 1;
    IF v_id IS NULL THEN
      SELECT y.id INTO v_id FROM gapmc.yards y WHERE y.name ILIKE '%Margao%Main%' ORDER BY y.name LIMIT 1;
    END IF;
    IF v_id IS NULL THEN
      SELECT y.id INTO v_id FROM gapmc.yards y ORDER BY y.name LIMIT 1;
    END IF;
    RETURN v_id;
  END IF;

  SELECT y.id INTO v_id
  FROM gapmc.yards y
  WHERE lower(y.name) = v
     OR lower(y.name) LIKE v || ' %'
     OR lower(y.name) LIKE '%' || v || '%'
  ORDER BY
    CASE
      WHEN lower(y.name) = v THEN 0
      WHEN lower(y.name) LIKE v || ' %' THEN 1
      ELSE 2
    END,
    length(y.name)
  LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  IF v LIKE '%mapusa%' THEN
    SELECT y.id INTO v_id FROM gapmc.yards y WHERE y.code = 'Y-MAP' LIMIT 1;
  ELSIF v LIKE '%margao%' THEN
    SELECT y.id INTO v_id FROM gapmc.yards y WHERE y.code = 'Y-MAR' LIMIT 1;
  ELSIF v LIKE '%ponda%' THEN
    SELECT y.id INTO v_id FROM gapmc.yards y WHERE y.code = 'Y-PON' LIMIT 1;
  ELSIF v LIKE '%canacona%' THEN
    SELECT y.id INTO v_id FROM gapmc.yards y WHERE y.code = 'Y-CAN' LIMIT 1;
  ELSIF v LIKE '%sanquelim%' THEN
    SELECT y.id INTO v_id FROM gapmc.yards y WHERE y.code = 'Y-SAN' LIMIT 1;
  ELSIF v LIKE '%curchorem%' THEN
    SELECT y.id INTO v_id FROM gapmc.yards y WHERE y.code = 'Y-CUR' LIMIT 1;
  ELSIF v LIKE '%pernem%' THEN
    SELECT y.id INTO v_id FROM gapmc.yards y WHERE y.code = 'Y-PER' LIMIT 1;
  ELSIF v LIKE '%valpoi%' THEN
    SELECT y.id INTO v_id FROM gapmc.yards y WHERE y.code = 'Y-VAL' LIMIT 1;
  END IF;

  IF v_id IS NULL THEN
    SELECT y.id INTO v_id FROM gapmc.yards y WHERE y.code = 'Y-MAR' LIMIT 1;
  END IF;
  IF v_id IS NULL THEN
    SELECT y.id INTO v_id FROM gapmc.yards y ORDER BY y.name LIMIT 1;
  END IF;
  RETURN v_id;
END;
$fn$;

DO $setup$
BEGIN
  IF to_regclass('public.applications') IS NULL THEN
    RAISE NOTICE 'public.applications not found — yard helper created; skip trigger/import';
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
      v_commodities jsonb;
      v_firm text;
      v_mobile text;
      v_yard_id text;
      v_status text;
      v_ts text;
      v_fee double precision;
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

      IF NEW.license_number IS NULL OR btrim(NEW.license_number::text) = '' THEN
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

      IF NEW.commodities IS NOT NULL THEN
        v_commodities := NEW.commodities::jsonb;
      ELSIF NEW.commodity IS NOT NULL AND btrim(NEW.commodity::text) <> '' THEN
        v_commodities := jsonb_build_array(btrim(NEW.commodity::text));
      ELSE
        v_commodities := NULL;
      END IF;

      UPDATE gapmc.trader_licences t
      SET
        firm_name = COALESCE(NULLIF(btrim(NEW.firm_name), ''), NULLIF(btrim(NEW.trader_name), ''), t.firm_name),
        contact_name = COALESCE(NULLIF(btrim(t.contact_name), ''), NULLIF(btrim(NEW.trader_name), ''), t.contact_name),
        mobile = COALESCE(NULLIF(regexp_replace(coalesce(NEW.mobile_number, ''), '[^0-9]', '', 'g'), ''), t.mobile),
        email = COALESCE(NULLIF(btrim(NEW.email), ''), t.email),
        address = COALESCE(
          NULLIF(btrim(NEW.business_address), ''),
          NULLIF(btrim(NEW.residential_address), ''),
          t.address
        ),
        pan = COALESCE(NULLIF(upper(btrim(NEW.pan_number)), ''), t.pan),
        gstin = COALESCE(NULLIF(upper(btrim(NEW.gst_number)), ''), t.gstin),
        firm_type = COALESCE(NULLIF(btrim(NEW.type_of_firm), ''), t.firm_type),
        fee_amount = COALESCE(NEW.license_fee::double precision, t.fee_amount),
        valid_to = COALESCE(v_valid_to, t.valid_to),
        valid_from = COALESCE(v_valid_from, t.valid_from),
        commodities = CASE WHEN v_commodities IS NULL THEN t.commodities ELSE v_commodities END,
        lm_status = NEW.status,
        lm_is_active = v_active,
        lm_license_class = NEW.license_class,
        lm_synced_at = now(),
        status = CASE
          WHEN COALESCE(t.is_blocked, false) THEN t.status
          WHEN t.status IN ('Active', 'Expired') AND v_active THEN 'Active'
          WHEN t.status IN ('Active', 'Expired') AND NOT v_active THEN 'Expired'
          WHEN t.status IN ('Draft', 'Pending', 'Query', 'Rejected') THEN t.status
          WHEN v_active THEN 'Active'
          ELSE 'Expired'
        END,
        updated_at = to_char(timezone('Asia/Kolkata', now()), 'YYYY-MM-DD"T"HH24:MI:SS')
      WHERE t.licence_no = NEW.license_number;

      IF FOUND THEN
        RETURN NEW;
      END IF;

      -- No App 2 row yet: create from LM (License Manager is master for issued licences)
      IF NEW.status NOT IN ('License Issued', 'License Expired') THEN
        RETURN NEW;
      END IF;

      v_yard_id := gapmc.resolve_yard_id_from_lm_yard(NEW.yard);
      IF v_yard_id IS NULL THEN
        RAISE WARNING 'LM sync skip %: no yard mapping for %', NEW.license_number, NEW.yard;
        RETURN NEW;
      END IF;

      v_firm := COALESCE(NULLIF(btrim(NEW.firm_name), ''), NULLIF(btrim(NEW.trader_name), ''), 'Unknown');
      v_mobile := NULLIF(regexp_replace(coalesce(NEW.mobile_number, ''), '[^0-9]', '', 'g'), '');
      IF v_mobile IS NULL OR length(v_mobile) < 10 THEN
        v_mobile := lpad(right(regexp_replace(NEW.license_number::text, '[^0-9]', '', 'g'), 10), 10, '0');
      ELSE
        v_mobile := right(v_mobile, 10);
      END IF;

      v_status := CASE WHEN v_active THEN 'Active' ELSE 'Expired' END;
      v_ts := to_char(timezone('Asia/Kolkata', now()), 'YYYY-MM-DD"T"HH24:MI:SS');
      v_fee := NEW.license_fee::double precision;

      INSERT INTO gapmc.trader_licences (
        id,
        licence_no,
        application_kind,
        firm_name,
        firm_type,
        yard_id,
        contact_name,
        mobile,
        email,
        address,
        pan,
        gstin,
        licence_type,
        fee_amount,
        valid_from,
        valid_to,
        status,
        is_blocked,
        renewal_no_arrears_declared,
        bm_undertaking_accepted,
        commodities,
        lm_status,
        lm_is_active,
        lm_license_class,
        lm_synced_at,
        created_at,
        updated_at
      ) VALUES (
        'lm-' || NEW.license_number,
        NEW.license_number,
        COALESCE(NULLIF(btrim(NEW.application_type), ''), 'New'),
        v_firm,
        NULLIF(btrim(NEW.type_of_firm), ''),
        v_yard_id,
        NULLIF(btrim(NEW.trader_name), ''),
        v_mobile,
        NULLIF(btrim(NEW.email), ''),
        COALESCE(NULLIF(btrim(NEW.business_address), ''), NULLIF(btrim(NEW.residential_address), '')),
        NULLIF(upper(btrim(NEW.pan_number)), ''),
        NULLIF(upper(btrim(NEW.gst_number)), ''),
        'Associated',
        v_fee,
        v_valid_from,
        v_valid_to,
        v_status,
        false,
        false,
        false,
        v_commodities,
        NEW.status,
        v_active,
        NEW.license_class,
        now(),
        v_ts,
        v_ts
      )
      ON CONFLICT (licence_no) DO NOTHING;

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
    mobile_number,
    email,
    business_address,
    residential_address,
    pan_number,
    gst_number,
    type_of_firm,
    license_fee,
    yard,
    application_type,
    updated_at
  ON public.applications
  FOR EACH ROW
  EXECUTE FUNCTION gapmc.sync_trader_licence_from_applications();

  CREATE TRIGGER trg_sync_trader_licence_from_applications_del
  AFTER DELETE ON public.applications
  FOR EACH ROW
  EXECUTE FUNCTION gapmc.sync_trader_licence_from_applications();

  -- One-time backfill: UPDATE existing matches
  UPDATE gapmc.trader_licences t
  SET
    firm_name = COALESCE(NULLIF(btrim(a.firm_name), ''), NULLIF(btrim(a.trader_name), ''), t.firm_name),
    contact_name = COALESCE(NULLIF(btrim(t.contact_name), ''), NULLIF(btrim(a.trader_name), ''), t.contact_name),
    mobile = COALESCE(NULLIF(regexp_replace(coalesce(a.mobile_number, ''), '[^0-9]', '', 'g'), ''), t.mobile),
    email = COALESCE(NULLIF(btrim(a.email), ''), t.email),
    address = COALESCE(
      NULLIF(btrim(a.business_address), ''),
      NULLIF(btrim(a.residential_address), ''),
      t.address
    ),
    pan = COALESCE(NULLIF(upper(btrim(a.pan_number)), ''), t.pan),
    gstin = COALESCE(NULLIF(upper(btrim(a.gst_number)), ''), t.gstin),
    firm_type = COALESCE(NULLIF(btrim(a.type_of_firm), ''), t.firm_type),
    fee_amount = COALESCE(a.license_fee::double precision, t.fee_amount),
    valid_to = COALESCE(
      to_char((a.expiry_date AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD'),
      t.valid_to
    ),
    valid_from = COALESCE(
      to_char((a.issue_date AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD'),
      t.valid_from
    ),
    commodities = COALESCE(
      CASE
        WHEN a.commodities IS NOT NULL THEN a.commodities::jsonb
        WHEN a.commodity IS NOT NULL AND btrim(a.commodity::text) <> '' THEN jsonb_build_array(btrim(a.commodity::text))
        ELSE NULL
      END,
      t.commodities
    ),
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
      WHEN t.status IN ('Draft', 'Pending', 'Query', 'Rejected') THEN t.status
      WHEN a.status = 'License Issued'
        AND a.superseded_by_license_number IS NULL
        AND (
          a.expiry_date IS NULL
          OR (a.expiry_date AT TIME ZONE 'UTC')::date
             >= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date
        )
        THEN 'Active'
      ELSE 'Expired'
    END,
    updated_at = to_char(timezone('Asia/Kolkata', now()), 'YYYY-MM-DD"T"HH24:MI:SS')
  FROM public.applications a
  WHERE t.licence_no = a.license_number
    AND a.license_number IS NOT NULL
    AND btrim(a.license_number::text) <> '';

  -- One-time backfill: INSERT LM licences missing from App 2
  INSERT INTO gapmc.trader_licences (
    id,
    licence_no,
    application_kind,
    firm_name,
    firm_type,
    yard_id,
    contact_name,
    mobile,
    email,
    address,
    pan,
    gstin,
    licence_type,
    fee_amount,
    valid_from,
    valid_to,
    status,
    is_blocked,
    renewal_no_arrears_declared,
    bm_undertaking_accepted,
    commodities,
    lm_status,
    lm_is_active,
    lm_license_class,
    lm_synced_at,
    created_at,
    updated_at
  )
  SELECT
    'lm-' || a.license_number,
    a.license_number,
    COALESCE(NULLIF(btrim(a.application_type), ''), 'New'),
    COALESCE(NULLIF(btrim(a.firm_name), ''), NULLIF(btrim(a.trader_name), ''), 'Unknown'),
    NULLIF(btrim(a.type_of_firm), ''),
    gapmc.resolve_yard_id_from_lm_yard(a.yard),
    NULLIF(btrim(a.trader_name), ''),
    CASE
      WHEN length(regexp_replace(coalesce(a.mobile_number, ''), '[^0-9]', '', 'g')) >= 10
        THEN right(regexp_replace(a.mobile_number, '[^0-9]', '', 'g'), 10)
      ELSE lpad(right(regexp_replace(a.license_number::text, '[^0-9]', '', 'g'), 10), 10, '0')
    END,
    NULLIF(btrim(a.email), ''),
    COALESCE(NULLIF(btrim(a.business_address), ''), NULLIF(btrim(a.residential_address), '')),
    NULLIF(upper(btrim(a.pan_number)), ''),
    NULLIF(upper(btrim(a.gst_number)), ''),
    'Associated',
    a.license_fee::double precision,
    CASE
      WHEN a.issue_date IS NULL THEN NULL
      ELSE to_char((a.issue_date AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD')
    END,
    CASE
      WHEN a.expiry_date IS NULL THEN NULL
      ELSE to_char((a.expiry_date AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD')
    END,
    CASE
      WHEN a.status = 'License Issued'
        AND a.superseded_by_license_number IS NULL
        AND (
          a.expiry_date IS NULL
          OR (a.expiry_date AT TIME ZONE 'UTC')::date
             >= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date
        )
        THEN 'Active'
      ELSE 'Expired'
    END,
    false,
    false,
    false,
    CASE
      WHEN a.commodities IS NOT NULL THEN a.commodities::jsonb
      WHEN a.commodity IS NOT NULL AND btrim(a.commodity::text) <> '' THEN jsonb_build_array(btrim(a.commodity::text))
      ELSE NULL
    END,
    a.status,
    (
      a.status = 'License Issued'
      AND a.superseded_by_license_number IS NULL
      AND (
        a.expiry_date IS NULL
        OR (a.expiry_date AT TIME ZONE 'UTC')::date
           >= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date
      )
    ),
    a.license_class,
    now(),
    to_char(timezone('Asia/Kolkata', now()), 'YYYY-MM-DD"T"HH24:MI:SS'),
    to_char(timezone('Asia/Kolkata', now()), 'YYYY-MM-DD"T"HH24:MI:SS')
  FROM public.applications a
  WHERE a.license_number IS NOT NULL
    AND btrim(a.license_number::text) <> ''
    AND a.status IN ('License Issued', 'License Expired')
    AND gapmc.resolve_yard_id_from_lm_yard(a.yard) IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM gapmc.trader_licences t WHERE t.licence_no = a.license_number
    );

  RAISE NOTICE 'LM → trader_licences INSERT sync + backfill applied';
END;
$setup$;
