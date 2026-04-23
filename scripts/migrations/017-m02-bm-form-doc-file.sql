-- M-02 Sr.9: optional Form BM supporting document file (PDF/JPEG/PNG in object storage; filename on row)
ALTER TABLE gapmc.trader_licences
  ADD COLUMN IF NOT EXISTS bm_form_doc_file text;
