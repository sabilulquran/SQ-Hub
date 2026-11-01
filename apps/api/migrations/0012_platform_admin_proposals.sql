-- HUB-IMPL-023 H-9: making someone an active Platform Administrator takes two different
-- Platform Administrators, and nobody can propose or confirm themselves.
--
-- A separate table instead of a third status on platform_administrators: activation is still the
-- same UPSERT on that table, but through the Hub it only happens inside the confirmation of a
-- pending proposal. Revoke-then-reactivate therefore needs a new proposal and a second person.
--
-- Additive. Recovery: deploy the previous build, then
--   DROP TABLE platform_admin_proposals;
--   DELETE FROM schema_migrations WHERE filename = '0012_platform_admin_proposals.sql';
-- platform_administrators and platform_audit_events are untouched by this migration.

CREATE TABLE IF NOT EXISTS platform_admin_proposals (
  id uuid PRIMARY KEY,
  identity_issuer text NOT NULL CHECK (length(trim(identity_issuer)) > 0),
  identity_subject text NOT NULL CHECK (length(trim(identity_subject)) > 0),
  proposer_issuer text NOT NULL CHECK (length(trim(proposer_issuer)) > 0),
  proposer_subject text NOT NULL CHECK (length(trim(proposer_subject)) > 0),
  reason text NOT NULL CHECK (length(trim(reason)) > 0),
  status text NOT NULL CHECK (status IN ('pending', 'confirmed', 'cancelled', 'expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  decided_issuer text NULL,
  decided_subject text NULL,
  decided_at timestamptz NULL,
  CHECK (expires_at > created_at),
  CHECK (NOT (proposer_issuer = identity_issuer AND proposer_subject = identity_subject)),
  CHECK (
    (status = 'pending' AND decided_at IS NULL AND decided_issuer IS NULL AND decided_subject IS NULL)
    OR (status = 'expired' AND decided_at IS NOT NULL)
    OR (status IN ('confirmed', 'cancelled') AND decided_at IS NOT NULL
        AND decided_issuer IS NOT NULL AND decided_subject IS NOT NULL)
  ),
  CHECK (
    status <> 'confirmed'
    OR (NOT (decided_issuer = proposer_issuer AND decided_subject = proposer_subject)
        AND NOT (decided_issuer = identity_issuer AND decided_subject = identity_subject))
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS platform_admin_proposals_one_pending_idx
  ON platform_admin_proposals (identity_issuer, identity_subject)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS platform_admin_proposals_status_idx
  ON platform_admin_proposals (status, created_at DESC);
