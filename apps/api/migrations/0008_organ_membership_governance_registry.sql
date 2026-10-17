-- HUB-IMPL-021 / ADR-0009: governance summary registry fields and Organ Yayasan membership.
-- Additive only. Hub stores no domain summary data.

ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS governance_summary_path text NULL,
  ADD COLUMN IF NOT EXISTS governance_audience text NULL,
  ADD COLUMN IF NOT EXISTS governance_order integer NOT NULL DEFAULT 0;

ALTER TABLE applications DROP CONSTRAINT IF EXISTS applications_governance_summary_check;
ALTER TABLE applications ADD CONSTRAINT applications_governance_summary_check CHECK (
  (governance_summary_path IS NULL AND governance_audience IS NULL)
  OR (
    governance_summary_path IS NOT NULL
    AND governance_audience IS NOT NULL
    -- A path on the canonical_url origin; never an absolute or protocol-relative URL.
    AND length(governance_summary_path) <= 512
    AND governance_summary_path ~ '^/[A-Za-z0-9._~!$&''()*+,;=:@%/-]*$'
    AND governance_summary_path !~ '^//'
    AND governance_audience ~ '^[A-Za-z0-9._:-]{1,255}$'
  )
);

CREATE TABLE IF NOT EXISTS organ_memberships (
  id uuid PRIMARY KEY,
  identity_issuer text NOT NULL CHECK (length(trim(identity_issuer)) > 0),
  identity_subject text NOT NULL CHECK (length(trim(identity_subject)) > 0),
  organ text NOT NULL CHECK (organ IN ('pembina', 'pengurus', 'pengawas')),
  position_label text NULL CHECK (position_label IS NULL OR length(trim(position_label)) BETWEEN 1 AND 120),
  term_start date NOT NULL,
  term_end date NULL CHECK (term_end IS NULL OR term_end > term_start),
  status text NOT NULL CHECK (status IN ('active', 'ended')),
  reason text NOT NULL CHECK (length(trim(reason)) > 0),
  -- existing_staff = Path A, organ_identity = Path B (identity provisioned for this membership).
  provisioning_path text NOT NULL CHECK (provisioning_path IN ('existing_staff', 'organ_identity')),
  actor_kind text NOT NULL CHECK (actor_kind IN ('human', 'service', 'system')),
  actor_ref text NOT NULL CHECK (length(trim(actor_ref)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz NULL,
  CHECK ((status = 'active' AND ended_at IS NULL) OR (status = 'ended' AND ended_at IS NOT NULL))
);

-- One identity has at most one active (and therefore at most one effective) membership.
CREATE UNIQUE INDEX IF NOT EXISTS organ_memberships_one_active_idx
  ON organ_memberships (identity_issuer, identity_subject)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS organ_memberships_status_term_idx
  ON organ_memberships (status, term_end);

REVOKE ALL ON organ_memberships FROM PUBLIC;
