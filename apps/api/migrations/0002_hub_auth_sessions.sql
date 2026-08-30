CREATE TABLE IF NOT EXISTS hub_oidc_transactions (
  id uuid PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  state text NOT NULL CHECK (length(trim(state)) > 0),
  code_verifier text NOT NULL CHECK (length(trim(code_verifier)) > 0),
  nonce text NOT NULL CHECK (length(trim(nonce)) > 0),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hub_oidc_transactions_expiry_idx
  ON hub_oidc_transactions (expires_at);

CREATE TABLE IF NOT EXISTS hub_sessions (
  id uuid PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  identity_issuer text NOT NULL CHECK (length(trim(identity_issuer)) > 0),
  identity_subject text NOT NULL CHECK (length(trim(identity_subject)) > 0),
  display_name text NOT NULL CHECK (length(trim(display_name)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz NULL,
  ip_address text NULL,
  user_agent text NULL
);

CREATE INDEX IF NOT EXISTS hub_sessions_token_active_idx
  ON hub_sessions (token_hash, expires_at)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS hub_sessions_identity_time_idx
  ON hub_sessions (identity_issuer, identity_subject, created_at DESC);
