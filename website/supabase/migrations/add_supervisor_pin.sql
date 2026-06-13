-- Add supervisor PIN (HMAC-SHA256 hash) to tenants table
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS supervisor_pin text;
