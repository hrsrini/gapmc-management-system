-- M-02 Sr.9: optional Form BM supporting document URL (https paste; uploads can map to same field later)
ALTER TABLE gapmc.trader_licences
  ADD COLUMN IF NOT EXISTS bm_form_doc_url text;
