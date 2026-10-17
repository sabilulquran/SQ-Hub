-- HUB-IMPL-021 §1: the membership page shows, read-only, which participating applications
-- currently return a summary for a member. Hub cannot request a summary as another person,
-- so it keeps only the last outcome it observed when that member opened Ringkasan Yayasan.
-- No summary body, figure, label or token is ever stored.
CREATE TABLE IF NOT EXISTS governance_summary_observations (
  identity_issuer text NOT NULL CHECK (length(trim(identity_issuer)) > 0),
  identity_subject text NOT NULL CHECK (length(trim(identity_subject)) > 0),
  application_key text NOT NULL CHECK (application_key ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  outcome text NOT NULL CHECK (outcome IN ('ready', 'forbidden', 'not_found', 'dropped', 'failed')),
  observed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (identity_issuer, identity_subject, application_key)
);

REVOKE ALL ON governance_summary_observations FROM PUBLIC;
