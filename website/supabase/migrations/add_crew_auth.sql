-- Crew member WebAuthn credentials (service-role only, no anon policy)
CREATE TABLE IF NOT EXISTS crew_member_credentials (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  crew_member_id   uuid        NOT NULL REFERENCES crew_members(id) ON DELETE CASCADE,
  credential_id    text        NOT NULL UNIQUE,
  public_key       text        NOT NULL,
  sign_count       bigint      NOT NULL DEFAULT 0,
  device_name      text,
  created_at       timestamptz DEFAULT now()
);

-- Initial PIN for crew member identity verification
ALTER TABLE crew_members ADD COLUMN IF NOT EXISTS initial_pin  text;
ALTER TABLE crew_members ADD COLUMN IF NOT EXISTS pin_set_at   timestamptz;

-- WebAuthn challenge store (short-lived, cleaned up after use)
CREATE TABLE IF NOT EXISTS crew_auth_challenges (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge      text        NOT NULL UNIQUE,
  crew_member_id uuid        REFERENCES crew_members(id) ON DELETE CASCADE,
  tenant_id      uuid        NOT NULL,
  type           text        NOT NULL, -- 'registration' | 'authentication'
  expires_at     timestamptz NOT NULL DEFAULT (now() + interval '5 minutes')
);
