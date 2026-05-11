-- Allow NULL dept on messages (broadcasts have dept = NULL)
-- The original schema had dept NOT NULL; this patch is required for
-- broadcast messages (sent to all departments).
ALTER TABLE messages ALTER COLUMN dept DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_tenant_dept ON messages (tenant_id, dept);
