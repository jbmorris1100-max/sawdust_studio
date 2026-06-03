-- Fix: job_drawings 400 errors (Postgres 42703 "column job_drawings.job_number does not exist")
-- The app selects/inserts job_drawings.job_number, but the live table was created
-- before that column existed. Add it. Safe to run multiple times.

ALTER TABLE job_drawings ADD COLUMN IF NOT EXISTS job_number text;
