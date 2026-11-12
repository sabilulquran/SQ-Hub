-- ORGAN-IMPL-001 §1.2: bind every session to the OIDC client that issued it, so a session cookie
-- from one SQ Hub host is never accepted on another (Hub, Kirim SQ, Kerja SQ, Portal Organ).
-- Additive: rows created before this migration stay NULL and are accepted only by the SQ Hub
-- configuration until they expire (at most HUB_SESSION_MAX_HOURS, 12 hours).
-- Rollback: application rollback leaves the column unused; it can be dropped afterwards.
ALTER TABLE hub_sessions ADD COLUMN IF NOT EXISTS client_id text NULL;
