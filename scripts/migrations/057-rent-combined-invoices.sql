-- M-03: Combined tax invoice / receipt bundle for multiple premises (same billing month).
create schema if not exists gapmc;

create table if not exists gapmc.rent_combined_invoices (
  id text primary key,
  bundle_invoice_no text not null unique,
  yard_id text not null,
  tenant_licence_id text not null,
  unified_entity_id text,
  period_month text not null,
  invoice_date text not null,
  total_rent_amount double precision not null default 0,
  total_cgst double precision not null default 0,
  total_sgst double precision not null default 0,
  total_tds_amount double precision not null default 0,
  total_amount double precision not null default 0,
  status text not null default 'Approved',
  created_by text,
  created_at text
);

create index if not exists rent_combined_invoices_tenant_period_idx
  on gapmc.rent_combined_invoices (tenant_licence_id, period_month);

alter table gapmc.rent_invoices
  add column if not exists combined_bundle_id text;

create index if not exists rent_invoices_combined_bundle_idx
  on gapmc.rent_invoices (combined_bundle_id);

create table if not exists gapmc.rent_invoice_payment_allocations (
  id text primary key,
  receipt_id text not null,
  invoice_id text not null,
  amount_inr double precision not null,
  created_at text
);

create index if not exists rent_invoice_payment_allocations_invoice_idx
  on gapmc.rent_invoice_payment_allocations (invoice_id);
