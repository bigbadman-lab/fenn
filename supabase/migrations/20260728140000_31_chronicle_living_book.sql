-- FENN Living Book — chronicle_entries daily coverage
-- Adds DAILY/CHRONICLE kinds + covered_date uniqueness for idempotent daily writes.

ALTER TABLE public.chronicle_entries
  DROP CONSTRAINT chronicle_entries_kind_check;

ALTER TABLE public.chronicle_entries
  ADD CONSTRAINT chronicle_entries_kind_check
  CHECK (kind IN (
    'notice',
    'milestone',
    'circulation',
    'treasury',
    'deed',
    'camp',
    'greenwood',
    'other',
    'daily',
    'chronicle'
  ));

ALTER TABLE public.chronicle_entries
  ADD COLUMN IF NOT EXISTS covered_date date;

ALTER TABLE public.chronicle_entries
  DROP CONSTRAINT IF EXISTS chronicle_entries_daily_covered_date_required;

ALTER TABLE public.chronicle_entries
  ADD CONSTRAINT chronicle_entries_daily_covered_date_required
  CHECK (kind <> 'daily' OR covered_date IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS chronicle_entries_daily_covered_date_uidx
  ON public.chronicle_entries (covered_date)
  WHERE kind = 'daily';

COMMENT ON COLUMN public.chronicle_entries.covered_date IS
  'UTC calendar day summarised by a DAILY Book entry. Required when kind = daily.';

COMMENT ON TABLE public.chronicle_entries IS
  'Living Book chronicle. kind=daily is one entry per covered_date (UTC). kind=chronicle is exceptional history.';
