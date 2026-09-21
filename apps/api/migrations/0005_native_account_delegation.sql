ALTER TABLE hub_oidc_transactions
  ADD COLUMN IF NOT EXISTS return_path text NULL;

ALTER TABLE hub_sessions
  ADD COLUMN IF NOT EXISTS account_refresh_token_ciphertext text NULL;
