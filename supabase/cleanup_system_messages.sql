-- ============================================================
-- Cleanup: remove system/automated notifications from the messages table.
-- Run in: Supabase Dashboard → SQL Editor → New Query
--
-- The messages table is now human-to-human chat + clock-in/out requests only.
-- Automated events (ready for assembly, parts cut, status changes, complete)
-- live in the notifications table instead (supervisor bell + crew home card).
-- This deletes the legacy system rows that were inserted into messages before
-- the app stopped writing them. Safe to run multiple times.
-- ============================================================

DELETE FROM messages
WHERE tenant_id = 'b69e7a5e-ea31-4b2d-a413-b32cb8f0289f'
  AND sender_name NOT IN ('Supervisor')
  AND (
    body LIKE '%ready for assembly%'
    OR body LIKE '%ready to assemble%'
    OR body LIKE '%is complete%'
    OR body LIKE '%parts cut%'
    OR body LIKE '%marked cut%'
  )
  AND topic IS NULL;

-- Optional: to apply the same cleanup across every tenant (not just the one
-- above), drop the tenant_id predicate:
--
-- DELETE FROM messages
-- WHERE sender_name NOT IN ('Supervisor')
--   AND (
--     body LIKE '%ready for assembly%'
--     OR body LIKE '%ready to assemble%'
--     OR body LIKE '%is complete%'
--     OR body LIKE '%parts cut%'
--     OR body LIKE '%marked cut%'
--   )
--   AND topic IS NULL;
