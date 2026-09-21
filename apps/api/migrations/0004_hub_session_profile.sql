ALTER TABLE hub_sessions
  ADD COLUMN IF NOT EXISTS username text NULL,
  ADD COLUMN IF NOT EXISTS email text NULL,
  ADD COLUMN IF NOT EXISTS email_verified boolean NULL;
