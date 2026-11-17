-- ORGAN-IMPL-001 R2: deciding inside the Portal Organ Yayasan.
--
-- Three additive pieces, none of which changes an existing row:
--
-- 1. The registry learns where an application takes decisions and under which audience. The rules
--    are the governance summary's rules (ORGAN-IMPL-001 §4.2): only a Platform Administrator sets
--    them, and the change is audited like any other registry change.
-- 2. Sessions record when the member last proved TOTP as a Level of Authentication, so the portal
--    can refuse before any token exchange when that proof has gone stale (ADR-0012 D4).
-- 3. One event row per forwarded decision. It holds no name, no note and no reason: a digest of
--    the actor, which application and step, which way it went, and how it was answered.
--
-- Rollback: switch PORTAL_ORGAN_DECISIONS_ENABLED off. The columns and the table are additive and
-- unreferenced; they may stay. To remove:
--   DROP TABLE organ_decision_events;
--   ALTER TABLE hub_sessions DROP COLUMN stepped_up_at;
--   ALTER TABLE applications DROP COLUMN decision_path, DROP COLUMN decision_audience;
ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS decision_path text NULL,
  ADD COLUMN IF NOT EXISTS decision_audience text NULL;

ALTER TABLE applications
  DROP CONSTRAINT IF EXISTS applications_decision_contract_check;

-- Same shape as the governance summary fields: a path that starts at the application's origin, an
-- audience that looks like a Keycloak client id, and neither alone — a path without an audience
-- could only be called with the wrong token, and an audience without a path has nothing to call.
ALTER TABLE applications
  ADD CONSTRAINT applications_decision_contract_check CHECK (
    (decision_path IS NULL AND decision_audience IS NULL)
    OR (
      decision_path ~ '^/[A-Za-z0-9._~!$&''()*+,;=:@%/-]{0,255}$'
      AND decision_audience ~ '^[A-Za-z0-9._:-]{1,255}$'
    )
  );

ALTER TABLE hub_sessions
  ADD COLUMN IF NOT EXISTS stepped_up_at timestamptz NULL;

CREATE TABLE IF NOT EXISTS organ_decision_events (
  id uuid PRIMARY KEY,
  -- A digest, not the identity: enough to follow one member's actions when something is disputed,
  -- never enough to read who they are out of this table.
  actor_digest text NOT NULL CHECK (actor_digest ~ '^[0-9a-f]{64}$'),
  application_key text NOT NULL CHECK (length(trim(application_key)) BETWEEN 1 AND 63),
  step_id text NOT NULL CHECK (length(trim(step_id)) BETWEEN 1 AND 255),
  decision text NOT NULL CHECK (decision IN ('approve', 'reject')),
  status_code integer NOT NULL CHECK (status_code BETWEEN 100 AND 599),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS organ_decision_events_time_idx
  ON organ_decision_events (occurred_at DESC);
