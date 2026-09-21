ALTER TABLE hub_oidc_transactions
  ADD COLUMN IF NOT EXISTS return_path text NULL,
  ADD COLUMN IF NOT EXISTS replace_session_token_hash text NULL,
  ADD COLUMN IF NOT EXISTS expected_identity_issuer text NULL,
  ADD COLUMN IF NOT EXISTS expected_identity_subject text NULL;

ALTER TABLE hub_sessions
  ADD COLUMN IF NOT EXISTS account_refresh_token_ciphertext text NULL;
