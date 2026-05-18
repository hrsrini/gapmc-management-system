-- M-01: date of occurrence when employee lifecycle status changes (VRS, suspension, etc.).
ALTER TABLE gapmc.employees
  ADD COLUMN IF NOT EXISTS status_effective_date text;

COMMENT ON COLUMN gapmc.employees.status_effective_date IS
  'YYYY-MM-DD date of occurrence for current lifecycle status (Active from, suspension, VRS, etc.).';
