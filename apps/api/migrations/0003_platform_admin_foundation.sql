CREATE TABLE IF NOT EXISTS platform_administrators (
  id uuid PRIMARY KEY,
  identity_issuer text NOT NULL CHECK (length(trim(identity_issuer)) > 0),
  identity_subject text NOT NULL CHECK (length(trim(identity_subject)) > 0),
  status text NOT NULL CHECK (status IN ('active', 'revoked')),
  reason text NULL,
  actor_kind text NOT NULL CHECK (actor_kind IN ('human', 'service', 'system')),
  actor_ref text NOT NULL CHECK (length(trim(actor_ref)) > 0),
  granted_at timestamptz NULL,
  revoked_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (identity_issuer, identity_subject),
  CHECK (
    (status = 'active' AND granted_at IS NOT NULL AND revoked_at IS NULL)
    OR (status = 'revoked' AND revoked_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS platform_administrators_identity_status_idx
  ON platform_administrators (identity_issuer, identity_subject, status);
