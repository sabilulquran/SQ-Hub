CREATE TABLE IF NOT EXISTS staff_lifecycle_operations (
  id uuid PRIMARY KEY,
  identity_issuer text NOT NULL,
  identity_subject text NOT NULL,
  status text NOT NULL CHECK (status IN ('IN_PROGRESS', 'PARTIAL_FAILURE', 'COMPLETED')),
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  actor_ref text NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (identity_issuer, identity_subject)
);

REVOKE ALL ON staff_lifecycle_operations FROM PUBLIC;
