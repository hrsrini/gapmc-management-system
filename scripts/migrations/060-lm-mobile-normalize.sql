-- M-02: Fix LM mobile sync — do not invent mobiles from licence numbers when LM has 'Imported - N/A'

CREATE OR REPLACE FUNCTION gapmc.normalize_lm_mobile(p_mobile text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $fn$
DECLARE
  d text := regexp_replace(coalesce(p_mobile, ''), '[^0-9]', '', 'g');
BEGIN
  IF d = '' THEN
    RETURN NULL;
  END IF;
  IF length(d) = 12 AND left(d, 2) = '91' THEN
    d := right(d, 10);
  ELSIF length(d) = 11 AND left(d, 1) = '0' THEN
    d := right(d, 10);
  ELSIF length(d) > 10 THEN
    d := right(d, 10);
  END IF;
  IF length(d) = 10 AND d ~ '^[6-9][0-9]{9}$' THEN
    RETURN d;
  END IF;
  RETURN NULL;
END;
$fn$;

DO $setup$
BEGIN
  IF to_regclass('public.applications') IS NULL THEN
    RAISE NOTICE 'public.applications not found — mobile helper created only';
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

      v_mobile := gapmc.normalize_lm_mobile(NEW.mobile_number);

      UPDATE gapmc.trader_licences t
      SET
        firm_name = COALESCE(NULLIF(btrim(NEW.firm_name), ''), NULLIF(btrim(NEW.trader_name), ''), t.firm_name),
        contact_name = COALESCE(NULLIF(btrim(t.contact_name), ''), NULLIF(btrim(NEW.trader_name), ''), t.contact_name),
        mobile = COALESCE(v_mobile, ''),
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

      IF NEW.status NOT IN ('License Issued', 'License Expired') THEN
        RETURN NEW;
      END IF;

      v_yard_id := gapmc.resolve_yard_id_from_lm_yard(NEW.yard);
      IF v_yard_id IS NULL THEN
        RAISE WARNING 'LM sync skip %: no yard mapping for %', NEW.license_number, NEW.yard;
        RETURN NEW;
      END IF;

      v_firm := COALESCE(NULLIF(btrim(NEW.firm_name), ''), NULLIF(btrim(NEW.trader_name), ''), 'Unknown');
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
        COALESCE(v_mobile, ''),
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

  -- Repair existing rows from LM source of truth
  UPDATE gapmc.trader_licences t
  SET
    mobile = COALESCE(gapmc.normalize_lm_mobile(a.mobile_number), ''),
    updated_at = to_char(timezone('Asia/Kolkata', now()), 'YYYY-MM-DD"T"HH24:MI:SS')
  FROM public.applications a
  WHERE t.licence_no = a.license_number
    AND a.license_number IS NOT NULL
    AND btrim(a.license_number::text) <> '';

  RAISE NOTICE 'LM mobile normalize + repair applied';
END;
$setup$;
