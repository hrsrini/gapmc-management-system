-- M-04: Unified market transaction wizard (cases A–G) with multi-commodity lines.
create schema if not exists gapmc;

create table if not exists gapmc.market_transactions (
  id text primary key,
  transaction_no text unique,
  case_type text not null,
  entry_location_id text not null,
  transaction_date text not null,
  transaction_time text,
  capture_mode text not null default 'Normal',
  capture_location_text text,
  vehicle_number text,
  vehicle_make text,
  vehicle_capacity_kg double precision,
  trader_licence_id text,
  trader_manual_name text,
  trader_manual_contact text,
  trader_manual_address text,
  receiver_trader_licence_id text,
  fee_payer text,
  seller_type text,
  farmer_type text,
  farmer_name text,
  farmer_krishi_card text,
  farmer_contact text,
  farmer_address text,
  commodity_source text,
  place_of_origin text,
  originating_state text,
  destination_state text,
  exit_checkposts_json text,
  any_exit_checkpost boolean default false,
  total_commodity_value double precision not null default 0,
  total_market_fee double precision not null default 0,
  fine_amount double precision not null default 0,
  security_deposit_amount double precision not null default 0,
  admin_charges_amount double precision not null default 0,
  total_payable double precision not null default 0,
  payment_mode text,
  payment_detail_json text,
  status text not null default 'Draft',
  receipt_id text,
  created_by text,
  created_at text,
  finalized_at text
);

create table if not exists gapmc.market_transaction_commodities (
  id text primary key,
  transaction_id text not null references gapmc.market_transactions(id) on delete cascade,
  sort_order integer not null default 0,
  commodity_id text not null,
  quantity double precision not null,
  unit text not null,
  rate_per_unit double precision not null,
  commodity_value double precision not null,
  market_fee_percent double precision not null,
  market_fee_amount double precision not null
);

create index if not exists market_transaction_commodities_tx_idx
  on gapmc.market_transaction_commodities (transaction_id);
