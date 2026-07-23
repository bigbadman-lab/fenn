-- FENN Stage 6.5 — Additive: private Deed evidence Storage bucket
-- LOCAL ONLY — do not apply until explicitly authorised.
-- Does not modify prior migration files.
--
-- Bucket is private. No anon/authenticated Storage policies are granted.
-- Application uploads/reads use service_role from trusted server code only.
--
-- Do NOT ALTER storage.objects here: that table is owned by the Storage
-- subsystem. RLS is already enabled by Supabase defaults. Without SELECT /
-- INSERT policies for anon/authenticated on this bucket, only service_role
-- (which bypasses RLS) can access objects.

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'deed-evidence',
  'deed-evidence',
  false,
  5242880, -- 5 MiB
  ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
