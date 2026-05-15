-- M-01: employee lifecycle internal status codes (INA, RET, VRS, SUS, RES, DEC, TER).
UPDATE gapmc.employees SET status = 'INA' WHERE status = 'Inactive';
UPDATE gapmc.employees SET status = 'RET' WHERE status = 'Retired';
UPDATE gapmc.employees SET status = 'RES' WHERE status = 'Resigned';
UPDATE gapmc.employees SET status = 'SUS' WHERE status = 'Suspended';
