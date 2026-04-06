# SRS v2 traceability sheet (starter)

Use this as the **single UAT / sign-off index**. Add rows for each SRS **FR / UC / SCR / Appendix** ID as you formalize testing.

| SRS ID | Requirement (short) | Status | Evidence |
|--------|----------------------|--------|----------|
| §1.4 | Employee–User ID coupling | Partial | `employees.user_id`, `users.employee_id`; `AdminUsers` + HR deactivate |
| §3.1 | DO → DV → DA workflow | Partial | `server/workflow.ts`, rent/voucher/leave + market purchase tx |
| CC-02 | Segregation DO/DV/DA | Partial | `assertSegregationDoDvDa` on rent, vouchers, `routes-market-ioms` purchase PUT |
| CC-14 | Tally ledger mapping & export | Partial | `tally_ledgers`, maps, `tally-export` API, `AdminFinanceMappings.tsx`, IOMS Reports CSV |
| CC-15 | Govt GST exempt (7 categories) | Partial | Seed, licence FK, `TraderLicenceDetail`, rent + receipts server |
| M-03 UC-RENT-01 | Monthly GST invoice generation | Partial | `server/cron-rent-invoices.ts`, rent routes |

_Add columns `Tester`, `Date` if needed for formal runs._
