-- TEST DATA ONLY — do not run against production without explicit authorisation.
-- Stage 6.5 manual QA fixture: Road Deed with text required + url optional + image required.

-- Replace :slug if needed. Requires evidence_requirements matching Stage 6.1 contract.

/*
INSERT INTO public.deeds (
  slug,
  title,
  lore_description,
  instructions,
  category,
  access_scope,
  status,
  reward_leaf_fixed,
  evidence_requirements,
  is_public,
  is_repeatable,
  published_at
) VALUES (
  'test-road-image-proof',
  'TEST — LEAVE A MARK',
  'a notice for local image evidence QA. not a launch deed.',
  'write what you did. attach one image. optional link.',
  'TEST',
  'road',
  'active',
  25,
  '{
    "text":  {"allowed": true,  "required": true},
    "url":   {"allowed": true,  "required": false},
    "image": {"allowed": true,  "required": true},
    "other": {"allowed": false, "required": false}
  }'::jsonb,
  true,
  false,
  timezone('utc', now())
);
*/
