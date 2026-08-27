CREATE TABLE IF NOT EXISTS applications (
  id uuid PRIMARY KEY,
  application_key text NOT NULL UNIQUE CHECK (
    application_key ~ '^[a-z0-9][a-z0-9-]{0,62}$'
  ),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  canonical_url text NOT NULL CHECK (length(trim(canonical_url)) > 0),
  status text NOT NULL CHECK (status IN ('active', 'inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS application_access (
  id uuid PRIMARY KEY,
  identity_issuer text NOT NULL CHECK (length(trim(identity_issuer)) > 0),
  identity_subject text NOT NULL CHECK (length(trim(identity_subject)) > 0),
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('active', 'revoked')),
  reason text NULL,
  actor_kind text NOT NULL CHECK (actor_kind IN ('human', 'service', 'system')),
  actor_ref text NOT NULL CHECK (length(trim(actor_ref)) > 0),
  granted_at timestamptz NULL,
  revoked_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (identity_issuer, identity_subject, application_id),
  CHECK (
    (status = 'active' AND granted_at IS NOT NULL AND revoked_at IS NULL)
    OR (status = 'revoked' AND revoked_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS application_access_identity_idx
  ON application_access (identity_issuer, identity_subject);

CREATE INDEX IF NOT EXISTS application_access_application_status_idx
  ON application_access (application_id, status);

CREATE TABLE IF NOT EXISTS platform_audit_events (
  id uuid PRIMARY KEY,
  actor_kind text NOT NULL CHECK (actor_kind IN ('human', 'service', 'system')),
  actor_ref text NOT NULL CHECK (length(trim(actor_ref)) > 0),
  action text NOT NULL CHECK (length(trim(action)) > 0),
  target_type text NOT NULL CHECK (length(trim(target_type)) > 0),
  target_ref text NOT NULL CHECK (length(trim(target_ref)) > 0),
  outcome text NOT NULL CHECK (outcome IN ('succeeded', 'failed', 'noop')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS platform_audit_events_target_time_idx
  ON platform_audit_events (target_type, target_ref, occurred_at DESC);

CREATE INDEX IF NOT EXISTS platform_audit_events_actor_time_idx
  ON platform_audit_events (actor_kind, actor_ref, occurred_at DESC);
