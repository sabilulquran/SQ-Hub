-- ORGAN-IMPL-001 §4.2 / ADR-0012 D4: carry the step-up requirement across the redirect.
--
-- `HubOidcAuthorizationTransaction` has had a `stepUp` field since R2, and the callback refuses a
-- login that did not reach the level it asks for. The transaction is persisted column by column in
-- this table, and no column was ever added for it, so the field was written nowhere and came back
-- undefined every time. The check therefore never ran: the authorization request asked the realm
-- for `acr_values=2`, and whatever the realm answered was accepted without being looked at.
--
-- Nothing unsafe was reachable — a session minted that way has `stepped_up_at` null, and the
-- decision routes refuse it — but a step-up could never succeed either.
--
-- Both columns are set together or not at all: a level with no freshness window, or a window with
-- no level, is not a requirement anyone could check.
--
-- Rollback:
--   ALTER TABLE hub_oidc_transactions
--     DROP CONSTRAINT hub_oidc_transactions_step_up_check,
--     DROP COLUMN step_up_acr,
--     DROP COLUMN step_up_max_age_seconds;
ALTER TABLE hub_oidc_transactions
  ADD COLUMN IF NOT EXISTS step_up_acr text NULL,
  ADD COLUMN IF NOT EXISTS step_up_max_age_seconds integer NULL;

ALTER TABLE hub_oidc_transactions
  DROP CONSTRAINT IF EXISTS hub_oidc_transactions_step_up_check;

ALTER TABLE hub_oidc_transactions
  ADD CONSTRAINT hub_oidc_transactions_step_up_check CHECK (
    (step_up_acr IS NULL AND step_up_max_age_seconds IS NULL)
    OR (
      step_up_acr ~ '^[A-Za-z0-9._:-]{1,64}$'
      AND step_up_max_age_seconds BETWEEN 1 AND 86400
    )
  );
