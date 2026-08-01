-- FENN — Living Greenwood 1: ASCII sigil catalogue + assignments
-- LOCAL ONLY — do not apply until explicitly authorised.
--
-- Establishes persistent profile-bound sigils for Greenwood members.
-- Does not alter admit_to_greenwood threshold / override behaviour.
-- Does not award LEAF.

-- ---------------------------------------------------------------------------
-- Catalogue
-- ---------------------------------------------------------------------------
CREATE TABLE public.greenwood_sigil_catalogue (
  id uuid PRIMARY KEY,
  slug text NOT NULL,
  ascii_body text NOT NULL,
  a11y_label text NOT NULL,
  width integer NOT NULL,
  height integer NOT NULL,
  status text NOT NULL DEFAULT 'active',
  is_fallback boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),

  CONSTRAINT greenwood_sigil_catalogue_slug_nonempty
    CHECK (length(trim(slug)) > 0),
  CONSTRAINT greenwood_sigil_catalogue_ascii_nonempty
    CHECK (length(ascii_body) > 0),
  CONSTRAINT greenwood_sigil_catalogue_a11y_nonempty
    CHECK (length(trim(a11y_label)) > 0),
  CONSTRAINT greenwood_sigil_catalogue_width_check
    CHECK (width > 0 AND width <= 16),
  CONSTRAINT greenwood_sigil_catalogue_height_check
    CHECK (height >= 3 AND height <= 5),
  CONSTRAINT greenwood_sigil_catalogue_status_check
    CHECK (status IN ('active', 'retired')),
  CONSTRAINT greenwood_sigil_catalogue_sort_order_nonnegative
    CHECK (sort_order >= 0)
);

CREATE UNIQUE INDEX greenwood_sigil_catalogue_slug_uidx
  ON public.greenwood_sigil_catalogue (slug);

CREATE UNIQUE INDEX greenwood_sigil_catalogue_sort_order_uidx
  ON public.greenwood_sigil_catalogue (sort_order);

-- At most one reserved fallback row.
CREATE UNIQUE INDEX greenwood_sigil_catalogue_fallback_uidx
  ON public.greenwood_sigil_catalogue ((is_fallback))
  WHERE is_fallback = true;

CREATE INDEX greenwood_sigil_catalogue_active_order_idx
  ON public.greenwood_sigil_catalogue (sort_order ASC, id ASC)
  WHERE status = 'active' AND is_fallback = false;

COMMENT ON TABLE public.greenwood_sigil_catalogue IS
  'Curated Greenwood ASCII sigils. Assignments reference catalogue ids; UNMARKED is the reserved fallback.';

-- ---------------------------------------------------------------------------
-- Assignments (one active row per Greenwood member profile)
-- ---------------------------------------------------------------------------
CREATE TABLE public.greenwood_sigil_assignments (
  profile_id uuid PRIMARY KEY REFERENCES public.profiles (id) ON DELETE RESTRICT,
  sigil_id uuid NOT NULL REFERENCES public.greenwood_sigil_catalogue (id) ON DELETE RESTRICT,
  assigned_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  assigned_by text NOT NULL DEFAULT 'system',
  previous_sigil_id uuid REFERENCES public.greenwood_sigil_catalogue (id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),

  CONSTRAINT greenwood_sigil_assignments_assigned_by_nonempty
    CHECK (length(trim(assigned_by)) > 0),
  CONSTRAINT greenwood_sigil_assignments_previous_differs
    CHECK (previous_sigil_id IS NULL OR previous_sigil_id <> sigil_id)
);

CREATE TRIGGER greenwood_sigil_assignments_set_updated_at
  BEFORE UPDATE ON public.greenwood_sigil_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- Unique among non-fallback marks (UNMARKED may be shared when pool is exhausted).
CREATE UNIQUE INDEX greenwood_sigil_assignments_unique_sigil_uidx
  ON public.greenwood_sigil_assignments (sigil_id)
  WHERE sigil_id <> 'a0000000-0000-4000-8000-000000000000'::uuid;

CREATE INDEX greenwood_sigil_assignments_sigil_id_idx
  ON public.greenwood_sigil_assignments (sigil_id);

COMMENT ON TABLE public.greenwood_sigil_assignments IS
  'One persistent ASCII sigil assignment per profile. Bound to profiles.id, never wallet.';

-- ---------------------------------------------------------------------------
-- RLS: no browser policies (service-role after Privy only)
-- ---------------------------------------------------------------------------
ALTER TABLE public.greenwood_sigil_catalogue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.greenwood_sigil_assignments ENABLE ROW LEVEL SECURITY;

-- Private tables: no browser role access. Service-role after Privy only.
REVOKE ALL ON public.greenwood_sigil_catalogue FROM anon, authenticated;
REVOKE ALL ON public.greenwood_sigil_assignments FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- Atomic assign: advisory lock + next unused curated mark
-- Ordering: catalogue.sort_order ASC, catalogue.id ASC
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assign_greenwood_sigil(
  p_profile_id uuid,
  p_assigned_by text DEFAULT 'system'
)
RETURNS TABLE (
  profile_id uuid,
  sigil_id uuid,
  slug text,
  ascii_body text,
  a11y_label text,
  width integer,
  height integer,
  is_fallback boolean,
  newly_assigned boolean,
  assigned_at timestamptz
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_existing public.greenwood_sigil_assignments%ROWTYPE;
  v_sigil public.greenwood_sigil_catalogue%ROWTYPE;
  v_by text;
  v_unmarked_id uuid := 'a0000000-0000-4000-8000-000000000000'::uuid;
BEGIN
  IF p_profile_id IS NULL THEN
    RAISE EXCEPTION 'FENN_VALIDATION: profile_id required'
      USING ERRCODE = '22023';
  END IF;

  v_by := nullif(trim(coalesce(p_assigned_by, '')), '');
  IF v_by IS NULL THEN
    RAISE EXCEPTION 'FENN_VALIDATION: assigned_by required'
      USING ERRCODE = '22023';
  END IF;

  -- Serialize assignment picks (prevents two profiles claiming one mark).
  PERFORM pg_advisory_xact_lock(87201433);

  SELECT *
  INTO v_profile
  FROM public.profiles p
  WHERE p.id = p_profile_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FENN_PROFILE_NOT_FOUND: profile missing'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_profile.greenwood_entered_at IS NULL THEN
    RAISE EXCEPTION 'FENN_GREENWOOD_MEMBERSHIP_REQUIRED: profile is not a Greenwood member'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT *
  INTO v_existing
  FROM public.greenwood_sigil_assignments a
  WHERE a.profile_id = p_profile_id;

  IF FOUND THEN
    SELECT c.*
    INTO v_sigil
    FROM public.greenwood_sigil_catalogue c
    WHERE c.id = v_existing.sigil_id;

    profile_id := v_existing.profile_id;
    sigil_id := v_existing.sigil_id;
    slug := v_sigil.slug;
    ascii_body := v_sigil.ascii_body;
    a11y_label := v_sigil.a11y_label;
    width := v_sigil.width;
    height := v_sigil.height;
    is_fallback := v_sigil.is_fallback;
    newly_assigned := false;
    assigned_at := v_existing.assigned_at;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT c.*
  INTO v_sigil
  FROM public.greenwood_sigil_catalogue c
  WHERE c.status = 'active'
    AND c.is_fallback = false
    AND NOT EXISTS (
      SELECT 1
      FROM public.greenwood_sigil_assignments a
      WHERE a.sigil_id = c.id
    )
  ORDER BY c.sort_order ASC, c.id ASC
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT c.*
    INTO v_sigil
    FROM public.greenwood_sigil_catalogue c
    WHERE c.id = v_unmarked_id
      AND c.is_fallback = true
      AND c.status = 'active';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'FENN_GREENWOOD_SIGIL_FALLBACK_MISSING: UNMARKED catalogue row missing'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  INSERT INTO public.greenwood_sigil_assignments (
    profile_id,
    sigil_id,
    assigned_by
  ) VALUES (
    p_profile_id,
    v_sigil.id,
    v_by
  )
  RETURNING * INTO v_existing;

  profile_id := v_existing.profile_id;
  sigil_id := v_existing.sigil_id;
  slug := v_sigil.slug;
  ascii_body := v_sigil.ascii_body;
  a11y_label := v_sigil.a11y_label;
  width := v_sigil.width;
  height := v_sigil.height;
  is_fallback := v_sigil.is_fallback;
  newly_assigned := true;
  assigned_at := v_existing.assigned_at;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.assign_greenwood_sigil(uuid, text) IS
  'Idempotent Greenwood sigil assignment. Next unused curated mark by sort_order,id; UNMARKED only when pool exhausted.';

REVOKE ALL ON FUNCTION public.assign_greenwood_sigil(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_greenwood_sigil(uuid, text) TO service_role;

-- ---------------------------------------------------------------------------
-- Deterministic backfill for existing members
-- Member order: outlaw_number ASC, greenwood_entered_at ASC, profiles.id ASC
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.backfill_greenwood_sigils()
RETURNS TABLE (
  processed integer,
  newly_assigned integer,
  unmarked_assigned integer
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_profile_id uuid;
  v_row record;
  v_processed integer := 0;
  v_new integer := 0;
  v_unmarked integer := 0;
BEGIN
  FOR v_profile_id IN
    SELECT p.id
    FROM public.profiles p
    WHERE p.greenwood_entered_at IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.greenwood_sigil_assignments a
        WHERE a.profile_id = p.id
      )
    ORDER BY p.outlaw_number ASC NULLS LAST,
             p.greenwood_entered_at ASC,
             p.id ASC
  LOOP
    SELECT * INTO v_row
    FROM public.assign_greenwood_sigil(v_profile_id, 'system_backfill');

    v_processed := v_processed + 1;
    IF v_row.newly_assigned THEN
      v_new := v_new + 1;
    END IF;
    IF v_row.is_fallback THEN
      v_unmarked := v_unmarked + 1;
    END IF;
  END LOOP;

  processed := v_processed;
  newly_assigned := v_new;
  unmarked_assigned := v_unmarked;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.backfill_greenwood_sigils() IS
  'Assigns sigils to Greenwood members missing an assignment. Safe to rerun.';

REVOKE ALL ON FUNCTION public.backfill_greenwood_sigils() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.backfill_greenwood_sigils() TO service_role;

-- ---------------------------------------------------------------------------
-- Seed catalogue (64 curated + UNMARKED)
-- ---------------------------------------------------------------------------
INSERT INTO public.greenwood_sigil_catalogue (
  id,
  slug,
  ascii_body,
  a11y_label,
  width,
  height,
  status,
  is_fallback,
  sort_order
) VALUES
(
  'a0000000-0000-4000-8000-000000000000'::uuid,
  'unmarked',
  $s0$  .  
 . . 
.....$s0$,
  'Unmarked — reserved fallback sigil',
  5,
  3,
  'active',
  true,
  0
),
(
  'a0000000-0000-4000-8000-000000000001'::uuid,
  'ember-notch',
  $s1$  /\
 /  \
/____\
  ||$s1$,
  'Ember notch — a small peaked mark',
  6,
  4,
  'active',
  false,
  1
),
(
  'a0000000-0000-4000-8000-000000000002'::uuid,
  'twin-sparks',
  $s2$ *  *
  \/
  /\
 *  *$s2$,
  'Twin sparks facing across a gap',
  5,
  4,
  'active',
  false,
  2
),
(
  'a0000000-0000-4000-8000-000000000003'::uuid,
  'ash-ring',
  $s3$ .--. 
(    )
 '--' $s3$,
  'Ash ring — a simple closed circle',
  6,
  3,
  'active',
  false,
  3
),
(
  'a0000000-0000-4000-8000-000000000004'::uuid,
  'split-bough',
  $s4$  |  
 /|\ 
/ | \
  |  $s4$,
  'Split bough branching once',
  5,
  4,
  'active',
  false,
  4
),
(
  'a0000000-0000-4000-8000-000000000005'::uuid,
  'hollow-gate',
  $s5$[=|=]
 | | 
 | | 
[=|=]$s5$,
  'Hollow gate of paired posts',
  5,
  4,
  'active',
  false,
  5
),
(
  'a0000000-0000-4000-8000-000000000006'::uuid,
  'low-flame',
  $s6$  )  
 ( ) 
(_._)$s6$,
  'Low flame cupped in ash',
  5,
  3,
  'active',
  false,
  6
),
(
  'a0000000-0000-4000-8000-000000000007'::uuid,
  'thorn-pair',
  $s7$  /\
 //\\
 \  /
  \/$s7$,
  'Thorn pair meeting at a point',
  5,
  4,
  'active',
  false,
  7
),
(
  'a0000000-0000-4000-8000-000000000008'::uuid,
  'moss-step',
  $s8$____
|__|
|  |
|__|$s8$,
  'Moss step — stacked stone mark',
  4,
  4,
  'active',
  false,
  8
),
(
  'a0000000-0000-4000-8000-000000000009'::uuid,
  'needle-fall',
  $s9$  |  
  |  
 \|/ 
  '  $s9$,
  'Needle fall from a high tip',
  5,
  4,
  'active',
  false,
  9
),
(
  'a0000000-0000-4000-8000-000000000010'::uuid,
  'cinder-cross',
  $s10$  +  
--+--
  +  $s10$,
  'Cinder cross of four arms',
  5,
  3,
  'active',
  false,
  10
),
(
  'a0000000-0000-4000-8000-000000000011'::uuid,
  'root-fork',
  $s11$  |  
  |  
 / \ 
/   \$s11$,
  'Root fork splitting downward',
  5,
  4,
  'active',
  false,
  11
),
(
  'a0000000-0000-4000-8000-000000000012'::uuid,
  'smoke-curl',
  $s12$  ~  
 ~ ~ 
~   ~
  ~  $s12$,
  'Smoke curl drifting upward',
  5,
  4,
  'active',
  false,
  12
),
(
  'a0000000-0000-4000-8000-000000000013'::uuid,
  'bark-slash',
  $s13$\\  //
 \\// 
  \/  $s13$,
  'Bark slash of crossing strokes',
  6,
  3,
  'active',
  false,
  13
),
(
  'a0000000-0000-4000-8000-000000000014'::uuid,
  'seed-pod',
  $s14$  ()  
 (  ) 
  )(  
  ''  $s14$,
  'Seed pod closed and hanging',
  6,
  4,
  'active',
  false,
  14
),
(
  'a0000000-0000-4000-8000-000000000015'::uuid,
  'grove-posts',
  $s15$| | |
| | |
|_|_|$s15$,
  'Three grove posts side by side',
  5,
  3,
  'active',
  false,
  15
),
(
  'a0000000-0000-4000-8000-000000000016'::uuid,
  'ember-arc',
  $s16$  __  
 /  \ 
 \__/
  ..  $s16$,
  'Ember arc over cooling coals',
  6,
  4,
  'active',
  false,
  16
),
(
  'a0000000-0000-4000-8000-000000000017'::uuid,
  'wedge-mark',
  $s17$  /|
 / |
/_/
  '$s17$,
  'Wedge mark cut into wood',
  4,
  4,
  'active',
  false,
  17
),
(
  'a0000000-0000-4000-8000-000000000018'::uuid,
  'night-hook',
  $s18$  /~
 /
 \
  \_$s18$,
  'Night hook curving once',
  4,
  4,
  'active',
  false,
  18
),
(
  'a0000000-0000-4000-8000-000000000019'::uuid,
  'stone-pile',
  $s19$  __
 /_/\
/_/\_\
  ''$s19$,
  'Stone pile of rough angles',
  6,
  4,
  'active',
  false,
  19
),
(
  'a0000000-0000-4000-8000-000000000020'::uuid,
  'reed-line',
  $s20$| | |
| | |
 \|/
  |$s20$,
  'Reed line bending to one stem',
  5,
  4,
  'active',
  false,
  20
),
(
  'a0000000-0000-4000-8000-000000000021'::uuid,
  'coal-nest',
  $s21$ .  . 
. __ .
'(__)'$s21$,
  'Coal nest holding a dark heart',
  6,
  3,
  'active',
  false,
  21
),
(
  'a0000000-0000-4000-8000-000000000022'::uuid,
  'branch-y',
  $s22$ \ / 
  ^  
  |  
  |  $s22$,
  'Branch fork rising from a trunk',
  5,
  4,
  'active',
  false,
  22
),
(
  'a0000000-0000-4000-8000-000000000023'::uuid,
  'rim-cut',
  $s23$[----]
|    |
[----]$s23$,
  'Rim cut — open rectangular frame',
  6,
  3,
  'active',
  false,
  23
),
(
  'a0000000-0000-4000-8000-000000000024'::uuid,
  'flint-edge',
  $s24$  /|
 / |
/__|
\   $s24$,
  'Flint edge with a hard corner',
  4,
  4,
  'active',
  false,
  24
),
(
  'a0000000-0000-4000-8000-000000000025'::uuid,
  'drip-mark',
  $s25$  .  
  |  
  |  
 / \ $s25$,
  'Drip mark falling to a base',
  5,
  4,
  'active',
  false,
  25
),
(
  'a0000000-0000-4000-8000-000000000026'::uuid,
  'knot-loop',
  $s26$ .--. 
/    \
\    /
 '--' $s26$,
  'Knot loop closed twice',
  6,
  4,
  'active',
  false,
  26
),
(
  'a0000000-0000-4000-8000-000000000027'::uuid,
  'lean-spar',
  $s27$   /
  /
 /
/$s27$,
  'Lean spar tilting left',
  4,
  4,
  'active',
  false,
  27
),
(
  'a0000000-0000-4000-8000-000000000028'::uuid,
  'pitch-fork',
  $s28$| | |
 \|/ 
  |  
  |  $s28$,
  'Pitch fork of three tines',
  5,
  4,
  'active',
  false,
  28
),
(
  'a0000000-0000-4000-8000-000000000029'::uuid,
  'ember-dot',
  $s29$  .  
 .*. 
.*.*.
  '  $s29$,
  'Ember dots arranged as a spark',
  5,
  4,
  'active',
  false,
  29
),
(
  'a0000000-0000-4000-8000-000000000030'::uuid,
  'ridge-line',
  $s30$/\/\/
\/\/\
  --  $s30$,
  'Ridge line of repeating peaks',
  6,
  3,
  'active',
  false,
  30
),
(
  'a0000000-0000-4000-8000-000000000031'::uuid,
  'cup-mark',
  $s31$\   /
 \_/ 
  |  
  |  $s31$,
  'Cup mark held above a stem',
  5,
  4,
  'active',
  false,
  31
),
(
  'a0000000-0000-4000-8000-000000000032'::uuid,
  'bar-gate',
  $s32$====
 || 
 || 
====$s32$,
  'Bar gate of twin uprights',
  4,
  4,
  'active',
  false,
  32
),
(
  'a0000000-0000-4000-8000-000000000033'::uuid,
  'twist-vine',
  $s33$  /\
 \/\
 /\/
 \/$s33$,
  'Twist vine of interlocking zigzags',
  4,
  4,
  'active',
  false,
  33
),
(
  'a0000000-0000-4000-8000-000000000034'::uuid,
  'hearth-box',
  $s34$+--+
|..|
|..|
+--+$s34$,
  'Hearth box with inner embers',
  4,
  4,
  'active',
  false,
  34
),
(
  'a0000000-0000-4000-8000-000000000035'::uuid,
  'spike-rise',
  $s35$  ^  
 /|\ 
  |  
  |  $s35$,
  'Spike rise pointing upward',
  5,
  4,
  'active',
  false,
  35
),
(
  'a0000000-0000-4000-8000-000000000036'::uuid,
  'owl-notch',
  $s36$ . . 
(   )
 \_/ $s36$,
  'Owl notch — paired hollow eyes',
  5,
  3,
  'active',
  false,
  36
),
(
  'a0000000-0000-4000-8000-000000000037'::uuid,
  'trail-dash',
  $s37$- - -
 - - 
- - -
  .  $s37$,
  'Trail dash of broken steps',
  5,
  4,
  'active',
  false,
  37
),
(
  'a0000000-0000-4000-8000-000000000038'::uuid,
  'wedge-pair',
  $s38$/\/\
\/\/
 /\ 
 \/ $s38$,
  'Wedge pair interlocking',
  4,
  4,
  'active',
  false,
  38
),
(
  'a0000000-0000-4000-8000-000000000039'::uuid,
  'post-and-beam',
  $s39$|---|
|   |
|---|
|   |$s39$,
  'Post and beam frame',
  5,
  4,
  'active',
  false,
  39
),
(
  'a0000000-0000-4000-8000-000000000040'::uuid,
  'curl-leaf',
  $s40$  ,  
 / \ 
 \_/ 
  '  $s40$,
  'Curl leaf resting on a tip',
  5,
  4,
  'active',
  false,
  40
),
(
  'a0000000-0000-4000-8000-000000000041'::uuid,
  'ash-ladder',
  $s41$|=|
|=|
|=|
|=|$s41$,
  'Ash ladder of four rungs',
  3,
  4,
  'active',
  false,
  41
),
(
  'a0000000-0000-4000-8000-000000000042'::uuid,
  'broken-ring',
  $s42$ .-. 
(   \
 \   )
  '-' $s42$,
  'Broken ring left open',
  6,
  4,
  'active',
  false,
  42
),
(
  'a0000000-0000-4000-8000-000000000043'::uuid,
  'stake-mark',
  $s43$  |
  |
 /|\
/_|_\$s43$,
  'Stake mark driven into ground',
  5,
  4,
  'active',
  false,
  43
),
(
  'a0000000-0000-4000-8000-000000000044'::uuid,
  'double-hook',
  $s44$~~\
   )
~~/
   $s44$,
  'Double hook of paired curves',
  4,
  4,
  'active',
  false,
  44
),
(
  'a0000000-0000-4000-8000-000000000045'::uuid,
  'pine-tip',
  $s45$  ^
 /^\
/^^^\
  |$s45$,
  'Pine tip tapering to a point',
  5,
  4,
  'active',
  false,
  45
),
(
  'a0000000-0000-4000-8000-000000000046'::uuid,
  'ember-bowl',
  $s46$\___/
 | |
 |_|$s46$,
  'Ember bowl on short legs',
  5,
  3,
  'active',
  false,
  46
),
(
  'a0000000-0000-4000-8000-000000000047'::uuid,
  'cross-path',
  $s47$  |  
--+--
  |  
  |  $s47$,
  'Cross path with a long stem',
  5,
  4,
  'active',
  false,
  47
),
(
  'a0000000-0000-4000-8000-000000000048'::uuid,
  'shard-fan',
  $s48$\ | /
 \|/ 
  |  $s48$,
  'Shard fan of three blades',
  5,
  3,
  'active',
  false,
  48
),
(
  'a0000000-0000-4000-8000-000000000049'::uuid,
  'low-arch',
  $s49$ /¯¯\
/    \
\____/$s49$,
  'Low arch spanning a base',
  6,
  3,
  'active',
  false,
  49
),
(
  'a0000000-0000-4000-8000-000000000050'::uuid,
  'dot-column',
  $s50$ .
 .
 .
_._$s50$,
  'Dot column above a base mark',
  3,
  4,
  'active',
  false,
  50
),
(
  'a0000000-0000-4000-8000-000000000051'::uuid,
  'hinge-mark',
  $s51$[|]
 | 
[|]
 | $s51$,
  'Hinge mark of stacked brackets',
  3,
  4,
  'active',
  false,
  51
),
(
  'a0000000-0000-4000-8000-000000000052'::uuid,
  'wave-ash',
  $s52$~ ~~
 ~~ 
~ ~~
  . $s52$,
  'Wave ash of soft undulation',
  4,
  4,
  'active',
  false,
  52
),
(
  'a0000000-0000-4000-8000-000000000053'::uuid,
  'trench-cut',
  $s53$____
\  /
 \/
 ||$s53$,
  'Trench cut narrowing downward',
  4,
  4,
  'active',
  false,
  53
),
(
  'a0000000-0000-4000-8000-000000000054'::uuid,
  'twin-posts',
  $s54$|  |
|  |
|__|
'  '$s54$,
  'Twin posts joined at the base',
  4,
  4,
  'active',
  false,
  54
),
(
  'a0000000-0000-4000-8000-000000000055'::uuid,
  'ember-chevron',
  $s55$  ^  
 / \ 
/   \
-----$s55$,
  'Ember chevron over a bar',
  5,
  4,
  'active',
  false,
  55
),
(
  'a0000000-0000-4000-8000-000000000056'::uuid,
  'coil-mark',
  $s56$  @  
 @ @ 
@   @
 @@@ $s56$,
  'Coil mark in a tight spiral',
  5,
  4,
  'active',
  false,
  56
),
(
  'a0000000-0000-4000-8000-000000000057'::uuid,
  'gap-bridge',
  $s57$|==|
|  |
|==|
 \/ $s57$,
  'Gap bridge with a hanging tip',
  4,
  4,
  'active',
  false,
  57
),
(
  'a0000000-0000-4000-8000-000000000058'::uuid,
  'flint-stack',
  $s58$  _
 /_\
/_._\
 \_/$s58$,
  'Flint stack of nested layers',
  5,
  4,
  'active',
  false,
  58
),
(
  'a0000000-0000-4000-8000-000000000059'::uuid,
  'silent-bell',
  $s59$ .-. 
(   )
 \_/ 
  |  $s59$,
  'Silent bell hanging still',
  5,
  4,
  'active',
  false,
  59
),
(
  'a0000000-0000-4000-8000-000000000060'::uuid,
  'ridge-post',
  $s60$ /\
/||\
 || 
 || $s60$,
  'Ridge post under a peak',
  4,
  4,
  'active',
  false,
  60
),
(
  'a0000000-0000-4000-8000-000000000061'::uuid,
  'ember-rail',
  $s61$=||=
 || 
 || 
'--'$s61$,
  'Ember rail between short bars',
  4,
  4,
  'active',
  false,
  61
),
(
  'a0000000-0000-4000-8000-000000000062'::uuid,
  'open-cradle',
  $s62$\   /
 \ /
  \/ 
  |  $s62$,
  'Open cradle narrowing to a point',
  5,
  4,
  'active',
  false,
  62
),
(
  'a0000000-0000-4000-8000-000000000063'::uuid,
  'night-stake',
  $s63$  !  
  |  
 / \ 
/___\$s63$,
  'Night stake with a warning tip',
  5,
  4,
  'active',
  false,
  63
),
(
  'a0000000-0000-4000-8000-000000000064'::uuid,
  'last-coal',
  $s64$  *  
 * * 
*___*
 ''' $s64$,
  'Last coal among fading sparks',
  5,
  4,
  'active',
  false,
  64
)

;

-- Run backfill for any existing Greenwood members.
SELECT * FROM public.backfill_greenwood_sigils();
