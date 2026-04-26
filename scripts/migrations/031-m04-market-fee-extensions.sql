-- M-04 extensions: daily prices, advance ledger, report snapshots, receipt linkage on checkpost inward.
-- Additive only; safe to re-run.

create schema if not exists gapmc;

-- Check post inward: link to M-05 receipt
alter table if exists gapmc.check_post_inward
  add column if not exists receipt_id text;

-- Daily official prices (yard/checkpost + commodity + date)
create table if not exists gapmc.market_daily_prices (
  id text primary key,
  yard_id text not null,
  date text not null,
  commodity_id text not null,
  min_price_inr_per_unit double precision not null,
  max_price_inr_per_unit double precision not null,
  modal_price_inr_per_unit double precision not null,
  sample_count integer not null default 0,
  total_qty double precision not null default 0,
  generated_at text,
  generated_by text
);

-- Advance deposit / adjustment ledger
create table if not exists gapmc.market_fee_ledger (
  id text primary key,
  trader_licence_id text not null,
  yard_id text not null,
  entry_date text not null,
  entry_type text not null,
  amount_inr double precision not null,
  receipt_id text,
  source_module text,
  source_record_id text,
  created_by text,
  created_at text
);

-- Report snapshots
create table if not exists gapmc.market_commodity_report_snapshots (
  id text primary key,
  report_kind text not null,
  yard_id text,
  "from" text not null,
  "to" text not null,
  rows_json jsonb not null,
  generated_at text not null,
  generated_by text
);

