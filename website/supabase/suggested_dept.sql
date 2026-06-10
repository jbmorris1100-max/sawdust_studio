-- Classifier suggestion column. Every cabinet/part starts in production on
-- upload; the AI classifier's craftsman/production determination is recorded
-- here as a suggestion the supervisor reviews in the Craftsman tab.
ALTER TABLE public.cabinet_units
  ADD COLUMN IF NOT EXISTS suggested_dept text;
