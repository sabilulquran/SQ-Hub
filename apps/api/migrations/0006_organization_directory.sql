-- HUB-IMPL-018: one atomic, source-owned read projection; no HCIS connection.
CREATE TABLE organization_directory_projection (
  source text PRIMARY KEY CHECK (source = 'hcis'),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  tombstones jsonb NOT NULL CHECK (jsonb_typeof(tombstones) = 'object'),
  synchronized_at timestamptz NOT NULL
);

CREATE TABLE organization_directory_sync_attempts (
  attempt_id uuid PRIMARY KEY,
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL,
  result text NOT NULL CHECK (result IN ('APPLIED', 'UNCHANGED', 'FAILED')),
  source_snapshot_id uuid,
  source_version text,
  as_of date NOT NULL,
  counts jsonb,
  error_category text CHECK (error_category IN (
    'contract_validation', 'source_regression', 'source_auth',
    'source_request', 'source_unavailable', 'storage'
  )),
  synchronized_at timestamptz
);
CREATE INDEX organization_directory_attempts_finished_idx
  ON organization_directory_sync_attempts (finished_at DESC);

REVOKE ALL ON organization_directory_projection, organization_directory_sync_attempts FROM PUBLIC;
