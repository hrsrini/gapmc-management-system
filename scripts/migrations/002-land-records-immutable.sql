-- Append-only enforcement for gapmc.land_records at database level (optional; run as superuser on gapmc DB).
-- Application already omits UPDATE/DELETE routes for land_records.

CREATE OR REPLACE FUNCTION gapmc.prevent_land_record_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'gapmc.land_records is append-only: UPDATE and DELETE are not allowed';
END;
$$;

DROP TRIGGER IF EXISTS tr_land_records_no_update ON gapmc.land_records;
CREATE TRIGGER tr_land_records_no_update
  BEFORE UPDATE ON gapmc.land_records
  FOR EACH ROW
  EXECUTE PROCEDURE gapmc.prevent_land_record_mutation();

DROP TRIGGER IF EXISTS tr_land_records_no_delete ON gapmc.land_records;
CREATE TRIGGER tr_land_records_no_delete
  BEFORE DELETE ON gapmc.land_records
  FOR EACH ROW
  EXECUTE PROCEDURE gapmc.prevent_land_record_mutation();
