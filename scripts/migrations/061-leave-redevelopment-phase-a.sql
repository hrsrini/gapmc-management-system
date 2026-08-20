-- M-01 Leave Redevelopment Phase A: schema additions
-- hr_holidays, leave_order_sequence, leave_requests extensions, employee_leave_balances extensions, employees extensions

-- 1. Holiday master
CREATE TABLE IF NOT EXISTS gapmc.hr_holidays (
  id TEXT PRIMARY KEY,
  year INTEGER NOT NULL,
  date TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL, -- Public | Special | Restricted | AdHoc
  is_tentative BOOLEAN DEFAULT FALSE,
  created_at TEXT,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_hr_holidays_year ON gapmc.hr_holidays(year);
CREATE INDEX IF NOT EXISTS idx_hr_holidays_date ON gapmc.hr_holidays(date);

-- 2. Leave order sequence (file numbering)
CREATE TABLE IF NOT EXISTS gapmc.leave_order_sequence (
  id TEXT PRIMARY KEY,
  year INTEGER NOT NULL,
  last_seq INTEGER NOT NULL DEFAULT 0
);

-- 3. leave_requests new columns
ALTER TABLE gapmc.leave_requests ADD COLUMN IF NOT EXISTS prefix_days INTEGER DEFAULT 0;
ALTER TABLE gapmc.leave_requests ADD COLUMN IF NOT EXISTS suffix_days INTEGER DEFAULT 0;
ALTER TABLE gapmc.leave_requests ADD COLUMN IF NOT EXISTS prefix_from_date TEXT;
ALTER TABLE gapmc.leave_requests ADD COLUMN IF NOT EXISTS suffix_to_date TEXT;
ALTER TABLE gapmc.leave_requests ADD COLUMN IF NOT EXISTS debit_days DOUBLE PRECISION;
ALTER TABLE gapmc.leave_requests ADD COLUMN IF NOT EXISTS substitute_employee_id TEXT;
ALTER TABLE gapmc.leave_requests ADD COLUMN IF NOT EXISTS address_during_leave TEXT;
ALTER TABLE gapmc.leave_requests ADD COLUMN IF NOT EXISTS ltc_proposed BOOLEAN DEFAULT FALSE;
ALTER TABLE gapmc.leave_requests ADD COLUMN IF NOT EXISTS leave_hq TEXT;
ALTER TABLE gapmc.leave_requests ADD COLUMN IF NOT EXISTS file_no TEXT;
ALTER TABLE gapmc.leave_requests ADD COLUMN IF NOT EXISTS order_pdf_url TEXT;
ALTER TABLE gapmc.leave_requests ADD COLUMN IF NOT EXISTS is_ex_post_facto BOOLEAN DEFAULT FALSE;
ALTER TABLE gapmc.leave_requests ADD COLUMN IF NOT EXISTS copy_to_json TEXT;
ALTER TABLE gapmc.leave_requests ADD COLUMN IF NOT EXISTS half_day TEXT;
ALTER TABLE gapmc.leave_requests ADD COLUMN IF NOT EXISTS duty_date_for_spl_h TEXT;
ALTER TABLE gapmc.leave_requests ADD COLUMN IF NOT EXISTS controlling_officer_remarks TEXT;
ALTER TABLE gapmc.leave_requests ADD COLUMN IF NOT EXISTS prefix_suffix_disallowed BOOLEAN DEFAULT FALSE;

-- 4. employee_leave_balances extensions
ALTER TABLE gapmc.employee_leave_balances ADD COLUMN IF NOT EXISTS set_off_days DOUBLE PRECISION DEFAULT 0;
ALTER TABLE gapmc.employee_leave_balances ADD COLUMN IF NOT EXISTS set_off_expiry_date TEXT;

-- 5. employees extensions
ALTER TABLE gapmc.employees ADD COLUMN IF NOT EXISTS service_book_no TEXT;
ALTER TABLE gapmc.employees ADD COLUMN IF NOT EXISTS section TEXT;
