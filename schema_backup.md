# Database Schema Backup

**Source:** `shared/db-schema.ts`  
**Schema:** PostgreSQL schema `gapmc` (Drizzle ORM)  
**Backup date:** 2025-02-26

All tables live in the `gapmc` schema. Enums are represented as `text` columns with app-defined values (no PG enum types).

---

## Original GAPMC Tables

### traders
| Column | Type | Constraints |
|--------|------|-------------|
| id | text | PK |
| asset_id | text | NOT NULL |
| name | text | NOT NULL |
| firm_name | text | |
| type | text | NOT NULL (Individual \| Firm \| Pvt Ltd \| Public Ltd) |
| mobile | text | NOT NULL |
| phone | text | |
| email | text | NOT NULL |
| residential_address | text | |
| business_address | text | |
| aadhaar | text | NOT NULL |
| pan | text | NOT NULL |
| gst | text | |
| epic_voter_id | text | |
| bank_name | text | |
| account_number | text | |
| ifsc_code | text | |
| branch_name | text | |
| yard_id | integer | NOT NULL |
| yard_name | text | NOT NULL |
| premises | text | NOT NULL |
| premises_type | text | NOT NULL (Stall \| Godown \| Shop) |
| registration_type | text | NOT NULL (Temporary \| Permanent) |
| commodities | jsonb (string[]) | NOT NULL |
| status | text | NOT NULL (Active \| Inactive \| Pending) |
| agreement_start | text | |
| agreement_end | text | |
| rent_amount | double precision | NOT NULL |
| security_deposit | double precision | NOT NULL |
| created_at | text | |
| updated_at | text | |

### invoices
| Column | Type | Constraints |
|--------|------|-------------|
| id | text | PK |
| trader_id | text | NOT NULL |
| trader_name | text | NOT NULL |
| premises | text | NOT NULL |
| yard | text | NOT NULL |
| yard_id | integer | NOT NULL |
| month | text | NOT NULL |
| invoice_date | text | NOT NULL |
| base_rent | double precision | NOT NULL |
| cgst | double precision | NOT NULL |
| sgst | double precision | NOT NULL |
| interest | double precision | NOT NULL |
| total | double precision | NOT NULL |
| tds_applicable | boolean | NOT NULL |
| tds_amount | double precision | NOT NULL |
| status | text | NOT NULL (Paid \| Pending \| Overdue \| Draft) |
| notes | text | |
| created_at | text | |
| updated_at | text | |

### receipts
| Column | Type | Constraints |
|--------|------|-------------|
| id | text | PK |
| receipt_no | text | NOT NULL |
| receipt_date | text | NOT NULL |
| type | text | NOT NULL (Rent \| Market Fee \| License Fee \| Other) |
| trader_id | text | NOT NULL |
| trader_name | text | NOT NULL |
| head | text | NOT NULL |
| amount | double precision | NOT NULL |
| cgst | double precision | |
| sgst | double precision | |
| interest | double precision | |
| security_deposit | double precision | |
| tds_amount | double precision | |
| total | double precision | NOT NULL |
| payment_mode | text | NOT NULL (Cash \| Cheque \| Online \| Adjustment) |
| cheque_no | text | |
| cheque_bank | text | |
| cheque_date | text | |
| transaction_ref | text | |
| narration | text | |
| yard_id | integer | NOT NULL |
| yard_name | text | NOT NULL |
| issued_by | text | NOT NULL |
| status | text | NOT NULL (Active \| Voided) |
| created_at | text | |
| updated_at | text | |

### market_fees
| Column | Type | Constraints |
|--------|------|-------------|
| id | text | PK |
| receipt_no | text | NOT NULL |
| entry_date | text | NOT NULL |
| entry_type | text | NOT NULL (Import \| Export) |
| trader_id | text | NOT NULL |
| trader_name | text | NOT NULL |
| license_no | text | NOT NULL |
| address | text | |
| gst_pan | text | |
| commodity | text | NOT NULL |
| commodity_type | text | NOT NULL (Horticultural \| Non-Horticultural) |
| quantity | double precision | NOT NULL |
| unit | text | NOT NULL (Kg \| Quintal \| Ton \| Pieces \| Crates) |
| rate_per_unit | double precision | NOT NULL |
| total_value | double precision | NOT NULL |
| market_fee | double precision | NOT NULL |
| vehicle_type | text | NOT NULL |
| vehicle_number | text | NOT NULL |
| location_id | integer | NOT NULL |
| location_name | text | NOT NULL |
| payment_mode | text | NOT NULL (Cash \| Cheque \| Online) |
| created_at | text | |
| updated_at | text | |

### agreements
| Column | Type | Constraints |
|--------|------|-------------|
| id | text | PK |
| agreement_id | text | NOT NULL |
| trader_id | text | NOT NULL |
| trader_name | text | NOT NULL |
| premises | text | NOT NULL |
| yard_id | integer | NOT NULL |
| yard_name | text | NOT NULL |
| start_date | text | NOT NULL |
| end_date | text | NOT NULL |
| rent_amount | double precision | NOT NULL |
| security_deposit | double precision | NOT NULL |
| status | text | NOT NULL (Active \| Expiring Soon \| Expired \| Terminated) |
| created_at | text | |
| updated_at | text | |

### stock_returns
| Column | Type | Constraints |
|--------|------|-------------|
| id | text | PK |
| trader_id | text | NOT NULL |
| trader_name | text | NOT NULL |
| period | text | NOT NULL |
| commodity | text | NOT NULL |
| opening_balance | double precision | NOT NULL |
| locally_procured | double precision | NOT NULL |
| purchased_from_trader | double precision | NOT NULL |
| sales | double precision | NOT NULL |
| closing_balance | double precision | NOT NULL |
| status | text | NOT NULL (Draft \| Submitted) |
| created_at | text | |
| updated_at | text | |

### activity_logs
| Column | Type | Constraints |
|--------|------|-------------|
| id | text | PK |
| action | text | NOT NULL |
| module | text | NOT NULL |
| user | text | NOT NULL |
| timestamp | text | NOT NULL |
| details | text | |

---

## IOMS (GAPLMB) — Module M-10: RBAC & System Administration

### yards
| Column | Type | Constraints |
|--------|------|-------------|
| id | text | PK |
| name | text | NOT NULL |
| code | text | NOT NULL, UNIQUE |
| type | text | NOT NULL (Yard \| CheckPost) |
| phone | text | |
| mobile | text | |
| address | text | |
| is_active | boolean | DEFAULT true |

### users
| Column | Type | Constraints |
|--------|------|-------------|
| id | text | PK |
| email | text | NOT NULL, UNIQUE |
| name | text | NOT NULL |
| phone | text | |
| employee_id | text | (FK → employees) |
| password_hash | text | |
| is_active | boolean | DEFAULT true |
| created_at | text | |
| updated_at | text | |

### roles
| Column | Type | Constraints |
|--------|------|-------------|
| id | text | PK |
| name | text | NOT NULL, UNIQUE |
| tier | text | NOT NULL (DO \| DV \| DA \| READ_ONLY \| ADMIN) |
| description | text | |

### user_roles
| Column | Type | Constraints |
|--------|------|-------------|
| user_id | text | NOT NULL, PK (composite) |
| role_id | text | NOT NULL, PK (composite) |

### permissions
| Column | Type | Constraints |
|--------|------|-------------|
| id | text | PK |
| module | text | NOT NULL |
| action | text | NOT NULL (Create \| Read \| Update \| Delete \| Approve) |

### role_permissions
| Column | Type | Constraints |
|--------|------|-------------|
| role_id | text | NOT NULL, PK (composite) |
| permission_id | text | NOT NULL, PK (composite) |

### user_yards
| Column | Type | Constraints |
|--------|------|-------------|
| user_id | text | NOT NULL, PK (composite) |
| yard_id | text | NOT NULL, PK (composite) |

### system_config
| Column | Type | Constraints |
|--------|------|-------------|
| key | text | PK |
| value | text | NOT NULL |
| updated_by | text | |
| updated_at | text | |

### sla_config
| Column | Type | Constraints |
|--------|------|-------------|
| id | text | PK |
| workflow | text | NOT NULL |
| hours | integer | NOT NULL |
| alert_role | text | |

### audit_log
| Column | Type | Constraints |
|--------|------|-------------|
| id | text | PK |
| user_id | text | NOT NULL |
| module | text | NOT NULL |
| action | text | NOT NULL |
| record_id | text | |
| before_value | jsonb | |
| after_value | jsonb | |
| ip | text | |
| created_at | text | NOT NULL |

---

## IOMS M-05: Receipts Online

### receipt_sequence
| Column | Type | Constraints |
|--------|------|-------------|
| yard_id | text | NOT NULL, PK (composite) |
| revenue_head | text | NOT NULL, PK (composite) |
| financial_year | text | NOT NULL, PK (composite) |
| last_seq | integer | NOT NULL, DEFAULT 0 |

### payment_gateway_log
| Column | Type | Constraints |
|--------|------|-------------|
| id | text | PK |
| receipt_id | text | NOT NULL |
| gateway | text | NOT NULL |
| gateway_txn_id | text | |
| status | text | NOT NULL |
| amount | double precision | NOT NULL |
| gateway_response | jsonb | |
| created_at | text | NOT NULL |

### ioms_receipts
| Column | Type | Constraints |
|--------|------|-------------|
| id | text | PK |
| receipt_no | text | NOT NULL, UNIQUE |
| yard_id | text | NOT NULL |
| revenue_head | text | NOT NULL (Rent \| GSTInvoice \| MarketFee \| LicenceFee \| SecurityDeposit \| Miscellaneous) |
| payer_name | text | |
| payer_type | text | |
| payer_ref_id | text | |
| amount | double precision | NOT NULL |
| cgst | double precision | DEFAULT 0 |
| sgst | double precision | DEFAULT 0 |
| total_amount | double precision | NOT NULL |
| payment_mode | text | NOT NULL (Online \| Cash \| Cheque \| DD) |
| gateway_ref | text | |
| cheque_no | text | |
| bank_name | text | |
| cheque_date | text | |
| source_module | text | (M-02 \| M-03 \| M-04 \| M-06 \| M-08) |
| source_record_id | text | |
| qr_code_url | text | |
| pdf_url | text | |
| status | text | NOT NULL (Pending \| Paid \| Failed \| Reconciled) |
| created_by | text | NOT NULL |
| created_at | text | NOT NULL |

---

## IOMS M-01: HRMS & Service Record

### employees
| Column | Type | Constraints |
|--------|------|-------------|
| id | text | PK |
| emp_id | text | UNIQUE (EMP-[LOC]-[YEAR]-[NNN]) |
| first_name | text | NOT NULL |
| middle_name | text | |
| surname | text | NOT NULL |
| photo_url | text | |
| designation | text | NOT NULL |
| yard_id | text | NOT NULL |
| employee_type | text | NOT NULL |
| aadhaar_token | text | |
| pan | text | |
| dob | text | |
| joining_date | text | NOT NULL |
| retirement_date | text | |
| mobile | text | |
| work_email | text | |
| status | text | NOT NULL (Active \| Inactive \| Suspended \| Retired \| Resigned) |
| user_id | text | |
| created_at | text | |
| updated_at | text | |

### employee_contracts
| Column | Type | Constraints |
|--------|------|-------------|
| id | text | PK |
| employee_id | text | NOT NULL |
| contract_type | text | NOT NULL |
| pay_scale | text | |
| start_date | text | NOT NULL |
| end_date | text | |

### recruitment
| Column | Type | Constraints |
|--------|------|-------------|
| id | text | PK |
| position | text | NOT NULL |
| applicant_name | text | NOT NULL |
| qualification | text | |
| applied_date | text | NOT NULL |
| status | text | NOT NULL |
| interview_outcomes | jsonb | |
| decision | text | |

### attendances
| Column | Type | Constraints |
|--------|------|-------------|
| id | text | PK |
| employee_id | text | NOT NULL |
| date | text | NOT NULL |
| action | text | NOT NULL (CheckIn \| CheckOut) |
| reason | text | |

### timesheets
| Column | Type | Constraints |
|--------|------|-------------|
| id | text | PK |
| employee_id | text | NOT NULL |
| period_start | text | NOT NULL |
| period_end | text | NOT NULL |
| total_attendance | double precision | |
| total_timesheet | double precision | |
| status | text | NOT NULL |
| validated_by | text | |

### service_book_entries
| Column | Type | Constraints |
|--------|------|-------------|
| id | text | PK |
| employee_id | text | NOT NULL |
| section | text | NOT NULL (Appendix \| AuditComments \| Verification \| History \| CertMutable \| CertImmutable) |
| content | jsonb | NOT NULL |
| is_immutable | boolean | DEFAULT false |
| status | text | NOT NULL |
| approved_by | text | |
| approved_at | text | |

### leave_requests
| Column | Type | Constraints |
|--------|------|-------------|
| id | text | PK |
| employee_id | text | NOT NULL |
| leave_type | text | NOT NULL |
| from_date | text | NOT NULL |
| to_date | text | NOT NULL |
| status | text | NOT NULL |
| approved_by | text | |

### ltc_claims
| Column | Type | Constraints |
|--------|------|-------------|
| id | text | PK |
| employee_id | text | NOT NULL |
| claim_date | text | NOT NULL |
| amount | double precision | NOT NULL |
| period | text | |
| status | text | NOT NULL |

### ta_da_claims
| Column | Type | Constraints |
|--------|------|-------------|
| id | text | PK |
| employee_id | text | NOT NULL |
| travel_date | text | NOT NULL |
| purpose | text | NOT NULL |
| amount | double precision | NOT NULL |
| status | text | NOT NULL |

---

## IOMS M-02: Trader & Asset ID Management

### trader_licences
| Column | Type | Constraints |
|--------|------|-------------|
| id | text | PK |
| licence_no | text | UNIQUE |
| firm_name | text | NOT NULL |
| firm_type | text | |
| yard_id | text | NOT NULL |
| contact_name | text | |
| mobile | text | NOT NULL |
| email | text | |
| address | text | |
| aadhaar_token | text | |
| pan | text | |
| gstin | text | |
| licence_type | text | NOT NULL (Associated \| Functionary \| Hamali \| Weighman \| AssistantTrader) |
| fee_amount | double precision | |
| receipt_id | text | |
| valid_from | text | |
| valid_to | text | |
| status | text | NOT NULL (Draft \| Pending \| Active \| Expired \| Blocked \| Rejected) |
| is_blocked | boolean | DEFAULT false |
| block_reason | text | |
| do_user | text | |
| dv_user | text | |
| da_user | text | |
| created_at | text | |
| updated_at | text | |

### assistant_traders
| Column | Type | Constraints |
|--------|------|-------------|
| id | text | PK |
| primary_licence_id | text | NOT NULL |
| person_name | text | NOT NULL |
| character_cert_issuer | text | |
| cert_date | text | |
| manual_licence_no | text | |
| status | text | NOT NULL |
| yard_id | text | NOT NULL |

### assets
| Column | Type | Constraints |
|--------|------|-------------|
| id | text | PK |
| asset_id | text | NOT NULL, UNIQUE ([LOC]/[TYPE]-[NNN]) |
| yard_id | text | NOT NULL |
| asset_type | text | NOT NULL (Shop \| Godown \| Office \| Building) |
| complex_name | text | |
| area | text | |
| plinth_area_sqft | double precision | |
| value | double precision | |
| file_number | text | |
| order_number | text | |
| is_active | boolean | DEFAULT true |

### asset_allotments
| Column | Type | Constraints |
|--------|------|-------------|
| id | text | PK |
| asset_id | text | NOT NULL |
| trader_licence_id | text | NOT NULL |
| allottee_name | text | NOT NULL |
| from_date | text | NOT NULL |
| to_date | text | NOT NULL |
| status | text | NOT NULL (Active \| Vacated) |
| security_deposit | double precision | |
| do_user | text | |
| da_user | text | |

### trader_blocking_log
| Column | Type | Constraints |
|--------|------|-------------|
| id | text | PK |
| trader_licence_id | text | NOT NULL |
| action | text | NOT NULL (Blocked \| Unblocked) |
| reason | text | NOT NULL |
| actioned_by | text | NOT NULL |
| actioned_at | text | NOT NULL |

### msp_settings
| Column | Type | Constraints |
|--------|------|-------------|
| id | text | PK |
| commodity | text | NOT NULL |
| msp_rate | double precision | NOT NULL |
| valid_from | text | NOT NULL |
| valid_to | text | NOT NULL |
| updated_by | text | |

---

## IOMS M-03: Rent / GST Tax Invoice

### rent_invoices
| Column | Type | Constraints |
|--------|------|-------------|
| id | text | PK |
| invoice_no | text | UNIQUE |
| allotment_id | text | NOT NULL |
| tenant_licence_id | text | NOT NULL |
| asset_id | text | NOT NULL |
| yard_id | text | NOT NULL |
| period_month | text | NOT NULL |
| rent_amount | double precision | NOT NULL |
| cgst | double precision | NOT NULL |
| sgst | double precision | NOT NULL |
| total_amount | double precision | NOT NULL |
| is_govt_entity | boolean | DEFAULT false |
| status | text | NOT NULL (Draft \| Verified \| Approved \| Paid \| Cancelled) |
| do_user | text | |
| dv_user | text | |
| da_user | text | |
| generated_at | text | |
| approved_at | text | |

### rent_deposit_ledger
| Column | Type | Constraints |
|--------|------|-------------|
| id | text | PK |
| tenant_licence_id | text | NOT NULL |
| asset_id | text | NOT NULL |
| entry_date | text | NOT NULL |
| entry_type | text | NOT NULL (OpeningBalance \| Rent \| Interest \| CGST \| SGST \| Collection) |
| debit | double precision | DEFAULT 0 |
| credit | double precision | DEFAULT 0 |
| balance | double precision | NOT NULL |
| invoice_id | text | |
| receipt_id | text | |

### credit_notes
| Column | Type | Constraints |
|--------|------|-------------|
| id | text | PK |
| credit_note_no | text | NOT NULL, UNIQUE |
| invoice_id | text | NOT NULL |
| reason | text | NOT NULL |
| amount | double precision | NOT NULL |
| status | text | NOT NULL (Draft \| Approved) |
| da_user | text | |
| approved_at | text | |

---

## IOMS M-04: Market Fee & Commodities

### commodities
| Column | Type | Constraints |
|--------|------|-------------|
| id | text | PK |
| name | text | NOT NULL |
| variety | text | |
| unit | text | |
| grade_type | text | |
| is_active | boolean | DEFAULT true |

### market_fee_rates
| Column | Type | Constraints |
|--------|------|-------------|
| id | text | PK |
| commodity_id | text | NOT NULL |
| fee_percent | double precision | DEFAULT 1 |
| valid_from | text | NOT NULL |
| valid_to | text | NOT NULL |
| yard_id | text | |

### farmers
| Column | Type | Constraints |
|--------|------|-------------|
| id | text | PK |
| name | text | NOT NULL |
| village | text | |
| taluk | text | |
| district | text | |
| mobile | text | |
| aadhaar_token | text | |
| yard_id | text | NOT NULL |

### purchase_transactions
| Column | Type | Constraints |
|--------|------|-------------|
| id | text | PK |
| transaction_no | text | UNIQUE |
| yard_id | text | NOT NULL |
| commodity_id | text | NOT NULL |
| farmer_id | text | |
| trader_licence_id | text | NOT NULL |
| quantity | double precision | NOT NULL |
| unit | text | NOT NULL |
| weight | double precision | |
| declared_value | double precision | NOT NULL |
| market_fee_percent | double precision | NOT NULL |
| market_fee_amount | double precision | NOT NULL |
| purchase_type | text | NOT NULL |
| grade | text | |
| transaction_date | text | NOT NULL |
| status | text | NOT NULL |
| receipt_id | text | |
| do_user | text | |
| dv_user | text | |
| da_user | text | |

### check_post_inward
| Column | Type | Constraints |
|--------|------|-------------|
| id | text | PK |
| entry_no | text | UNIQUE |
| check_post_id | text | NOT NULL |
| trader_licence_id | text | |
| invoice_number | text | |
| vehicle_number | text | |
| transaction_type | text | NOT NULL (Permanent \| Passway/Transit \| Temporary \| Prepaid \| Advance) |
| from_firm | text | |
| to_firm | text | |
| from_state | text | |
| to_state | text | |
| total_charges | double precision | |
| encoded_data | text | |
| entry_date | text | NOT NULL |
| officer_id | text | |
| status | text | NOT NULL (Draft \| Verified) |

### check_post_inward_commodities
| Column | Type | Constraints |
|--------|------|-------------|
| id | text | PK |
| inward_id | text | NOT NULL |
| commodity_id | text | NOT NULL |
| unit | text | NOT NULL |
| quantity | double precision | NOT NULL |
| value | double precision | NOT NULL |
| market_fee_percent | double precision | |
| market_fee_amount | double precision | |

### check_post_outward
| Column | Type | Constraints |
|--------|------|-------------|
| id | text | PK |
| entry_no | text | UNIQUE |
| check_post_id | text | NOT NULL |
| inward_ref_id | text | NOT NULL |
| vehicle_number | text | |
| receipt_number | text | |
| entry_date | text | NOT NULL |

### exit_permits
| Column | Type | Constraints |
|--------|------|-------------|
| id | text | PK |
| permit_no | text | NOT NULL, UNIQUE |
| inward_id | text | NOT NULL |
| issued_date | text | NOT NULL |
| officer_id | text | NOT NULL |

### check_post_bank_deposits
| Column | Type | Constraints |
|--------|------|-------------|
| id | text | PK |
| check_post_id | text | NOT NULL |
| deposit_date | text | NOT NULL |
| bank_name | text | NOT NULL |
| account_number | text | |
| amount | double precision | NOT NULL |
| voucher_details | text | |
| narration | text | |
| status | text | NOT NULL (Recorded \| Verified) |
| verified_by | text | |

---

## IOMS M-06: Payment Voucher Management

### expenditure_heads
| Column | Type | Constraints |
|--------|------|-------------|
| id | text | PK |
| code | text | NOT NULL, UNIQUE |
| description | text | NOT NULL |
| category | text | |
| is_active | boolean | DEFAULT true |

### payment_vouchers
| Column | Type | Constraints |
|--------|------|-------------|
| id | text | PK |
| voucher_no | text | UNIQUE |
| voucher_type | text | NOT NULL (Salary \| ContractorBill \| OperationalExpense \| AdvanceRequest \| Refund) |
| yard_id | text | NOT NULL |
| expenditure_head_id | text | NOT NULL |
| payee_name | text | NOT NULL |
| payee_account | text | |
| payee_bank | text | |
| amount | double precision | NOT NULL |
| description | text | |
| source_module | text | (M-07 \| M-08 \| M-01) |
| source_record_id | text | |
| supporting_docs | jsonb (string[]) | |
| status | text | NOT NULL (Draft \| Submitted \| Verified \| Approved \| Paid \| Rejected) |
| do_user | text | |
| dv_user | text | |
| da_user | text | |
| paid_at | text | |
| payment_ref | text | |
| created_at | text | |

### advance_requests
| Column | Type | Constraints |
|--------|------|-------------|
| id | text | PK |
| voucher_id | text | NOT NULL |
| employee_id | text | NOT NULL |
| purpose | text | NOT NULL |
| amount | double precision | NOT NULL |
| recovery_schedule | text | |
| recovered_amount | double precision | DEFAULT 0 |

---

## IOMS M-07: Vehicle Fleet Management

### vehicles
| Column | Type | Constraints |
|--------|------|-------------|
| id | text | PK |
| registration_no | text | NOT NULL, UNIQUE |
| vehicle_type | text | NOT NULL |
| capacity | text | |
| yard_id | text | NOT NULL |
| purchase_date | text | |
| purchase_value | double precision | |
| insurance_expiry | text | |
| fitness_expiry | text | |
| status | text | NOT NULL (Active \| UnderRepair \| Decommissioned) |
| do_user | text | |
| da_user | text | |

### vehicle_trip_log
| Column | Type | Constraints |
|--------|------|-------------|
| id | text | PK |
| vehicle_id | text | NOT NULL |
| driver_id | text | |
| trip_date | text | NOT NULL |
| purpose | text | |
| route | text | |
| odometer_start | double precision | |
| odometer_end | double precision | |
| distance_km | double precision | |
| fuel_consumed | double precision | |
| officer_id | text | |

### vehicle_fuel_register
| Column | Type | Constraints |
|--------|------|-------------|
| id | text | PK |
| vehicle_id | text | NOT NULL |
| fuel_date | text | NOT NULL |
| quantity_litres | double precision | NOT NULL |
| rate_per_litre | double precision | |
| total_amount | double precision | |
| voucher_id | text | |
| officer_id | text | |

### vehicle_maintenance
| Column | Type | Constraints |
|--------|------|-------------|
| id | text | PK |
| vehicle_id | text | NOT NULL |
| maintenance_type | text | NOT NULL (Scheduled \| Repair \| Inspection) |
| service_date | text | NOT NULL |
| description | text | |
| cost | double precision | |
| vendor_name | text | |
| voucher_id | text | |
| next_service_date | text | |
| officer_id | text | |

---

## IOMS M-08: Construction & Maintenance

### works
| Column | Type | Constraints |
|--------|------|-------------|
| id | text | PK |
| work_no | text | UNIQUE |
| yard_id | text | NOT NULL |
| work_type | text | NOT NULL |
| description | text | |
| location | text | |
| contractor_name | text | |
| contractor_contact | text | |
| estimate_amount | double precision | |
| tender_value | double precision | |
| work_order_no | text | |
| work_order_date | text | |
| start_date | text | |
| end_date | text | |
| completion_date | text | |
| status | text | NOT NULL (Planned \| InProgress \| Completed \| Closed) |
| do_user | text | |
| dv_user | text | |
| da_user | text | |

### works_bills
| Column | Type | Constraints |
|--------|------|-------------|
| id | text | PK |
| work_id | text | NOT NULL |
| bill_no | text | |
| bill_date | text | NOT NULL |
| amount | double precision | NOT NULL |
| cumulative_paid | double precision | DEFAULT 0 |
| voucher_id | text | |
| status | text | NOT NULL |
| approved_by | text | |

### amc_contracts
| Column | Type | Constraints |
|--------|------|-------------|
| id | text | PK |
| yard_id | text | NOT NULL |
| contractor_name | text | NOT NULL |
| description | text | |
| amount_per_period | double precision | NOT NULL |
| period_type | text | (Monthly \| Quarterly \| Annual) |
| contract_start | text | NOT NULL |
| contract_end | text | NOT NULL |
| status | text | NOT NULL (Active \| Expired \| Renewed) |
| da_user | text | |

### amc_bills
| Column | Type | Constraints |
|--------|------|-------------|
| id | text | PK |
| amc_id | text | NOT NULL |
| bill_date | text | NOT NULL |
| amount | double precision | NOT NULL |
| voucher_id | text | |

### land_records
| Column | Type | Constraints |
|--------|------|-------------|
| id | text | PK |
| yard_id | text | NOT NULL |
| survey_no | text | NOT NULL |
| village | text | |
| taluk | text | |
| district | text | |
| area_sqm | double precision | |
| sale_deed_no | text | |
| sale_deed_date | text | |
| encumbrance | text | |
| remarks | text | |
| created_by | text | NOT NULL |
| created_at | text | NOT NULL |

### fixed_assets
| Column | Type | Constraints |
|--------|------|-------------|
| id | text | PK |
| yard_id | text | NOT NULL |
| asset_type | text | NOT NULL |
| description | text | |
| acquisition_date | text | NOT NULL |
| acquisition_value | double precision | NOT NULL |
| useful_life_years | integer | |
| depreciation_method | text | |
| current_book_value | double precision | |
| disposal_date | text | |
| disposal_value | double precision | |
| disposal_approved_by | text | |
| works_id | text | |
| status | text | NOT NULL (Active \| Disposed) |

---

## IOMS M-09: Correspondence Management

### dak_inward
| Column | Type | Constraints |
|--------|------|-------------|
| id | text | PK |
| diary_no | text | UNIQUE |
| received_date | text | NOT NULL |
| from_party | text | NOT NULL |
| from_address | text | |
| subject | text | NOT NULL |
| mode_of_receipt | text | NOT NULL (Hand \| Post \| Courier \| Email \| Fax) |
| received_by | text | |
| assigned_to | text | |
| deadline | text | |
| file_ref | text | |
| status | text | NOT NULL (Pending \| InProgress \| Closed) |
| created_at | text | |

### dak_outward
| Column | Type | Constraints |
|--------|------|-------------|
| id | text | PK |
| despatch_no | text | UNIQUE |
| despatch_date | text | NOT NULL |
| to_party | text | NOT NULL |
| to_address | text | |
| subject | text | NOT NULL |
| mode_of_despatch | text | NOT NULL |
| inward_ref_id | text | |
| file_ref | text | |
| despatched_by | text | |
| created_at | text | |

### dak_action_log
| Column | Type | Constraints |
|--------|------|-------------|
| id | text | PK |
| inward_id | text | NOT NULL |
| action_by | text | NOT NULL |
| action_date | text | NOT NULL |
| action_note | text | |
| status_after | text | |

### dak_escalations
| Column | Type | Constraints |
|--------|------|-------------|
| id | text | PK |
| inward_id | text | NOT NULL |
| escalated_to | text | NOT NULL |
| escalation_reason | text | |
| escalated_at | text | NOT NULL |
| resolved_at | text | |

---

*End of schema backup*
