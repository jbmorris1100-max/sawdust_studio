-- QC notes and fail flag on parts — written by supervisor on QC kickback,
-- read by crew in the dept the part is returned to.
alter table parts
  add column if not exists qc_notes text,
  add column if not exists qc_failed boolean default false;

-- qc_notes on cabinet_units — displayed as a flag banner on the QC card.
alter table cabinet_units
  add column if not exists qc_notes text;
