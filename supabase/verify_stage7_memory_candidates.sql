-- FENN Stage 7.5 — Manual checks for memory_candidates + rewarded Camp turns
-- Run after a live Camp conversation that produced a flagged / rewarded turn.

-- 1) Pending candidates only; never auto-promoted
SELECT
  id,
  profile_id,
  character_id,
  camp_message_id,
  left(content, 80) AS content_preview,
  status,
  resulting_memory_id,
  created_at
FROM public.memory_candidates
ORDER BY created_at DESC
LIMIT 20;
-- expect status = pending, resulting_memory_id IS NULL

-- 2) One candidate per camp_message
SELECT camp_message_id, COUNT(*) AS n
FROM public.memory_candidates
WHERE camp_message_id IS NOT NULL
GROUP BY camp_message_id
HAVING COUNT(*) > 1;
-- expect 0 rows

-- 3) No Camp path should have written fenn_memories from candidates yet
SELECT COUNT(*) AS fenn_memories_from_candidates
FROM public.fenn_memories
WHERE source_candidate_id IS NOT NULL;
-- expect 0 for Stage 7

-- 4) Rewarded assistant messages match ledger
SELECT
  m.id AS message_id,
  m.reward_granted,
  m.leaf_ledger_id,
  l.amount AS ledger_amount,
  l.source_type,
  l.idempotency_key
FROM public.camp_messages m
LEFT JOIN public.leaf_ledger l ON l.id = m.leaf_ledger_id
WHERE m.role = 'assistant'
  AND m.reward_granted > 0
ORDER BY m.created_at DESC
LIMIT 20;
-- expect reward_granted = ledger_amount, source_type = camp,
-- idempotency_key = camp_message:<id>:reward

-- 5) Candidate content should be user contribution, not assistant reply
SELECT
  c.id AS candidate_id,
  c.camp_message_id AS assistant_message_id,
  left(c.content, 60) AS candidate_content,
  left(a.content, 60) AS assistant_content,
  a.memory_candidate_flag
FROM public.memory_candidates c
JOIN public.camp_messages a ON a.id = c.camp_message_id
ORDER BY c.created_at DESC
LIMIT 10;
-- expect candidate_content <> assistant_content typically
