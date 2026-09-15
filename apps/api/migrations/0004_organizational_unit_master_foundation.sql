CREATE TABLE IF NOT EXISTS organizational_units (
  id uuid PRIMARY KEY,
  unit_key text NOT NULL UNIQUE CHECK (unit_key ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  parent_id uuid NULL REFERENCES organizational_units(id) ON DELETE RESTRICT,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (parent_id IS NULL OR parent_id <> id)
);

CREATE INDEX IF NOT EXISTS organizational_units_parent_idx ON organizational_units(parent_id);
CREATE INDEX IF NOT EXISTS organizational_units_active_idx ON organizational_units(active, unit_key);

CREATE TABLE IF NOT EXISTS organizational_unit_import_runs (
  id uuid PRIMARY KEY,
  source_system text NOT NULL CHECK (length(btrim(source_system)) > 0),
  snapshot_fingerprint text NOT NULL CHECK (snapshot_fingerprint ~ '^[a-f0-9]{64}$'),
  row_count integer NOT NULL CHECK (row_count >= 0),
  result_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_kind text NOT NULL CHECK (actor_kind IN ('human', 'service', 'system')),
  actor_ref text NOT NULL CHECK (length(btrim(actor_ref)) > 0),
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  applied_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_system, snapshot_fingerprint)
);

CREATE TABLE IF NOT EXISTS organizational_unit_source_mappings (
  source_system text NOT NULL CHECK (length(btrim(source_system)) > 0),
  source_ref text NOT NULL CHECK (length(btrim(source_ref)) > 0),
  unit_id uuid NOT NULL REFERENCES organizational_units(id) ON DELETE RESTRICT,
  first_import_run_id uuid NOT NULL REFERENCES organizational_unit_import_runs(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_system, source_ref),
  UNIQUE (source_system, unit_id)
);

CREATE TABLE IF NOT EXISTS organizational_unit_foundation_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  ownership_state text NOT NULL CHECK (ownership_state IN ('PRE_CUTOVER', 'CUTOVER_ACCEPTED')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO organizational_unit_foundation_state (singleton, ownership_state)
VALUES (true, 'PRE_CUTOVER')
ON CONFLICT (singleton) DO NOTHING;

CREATE OR REPLACE FUNCTION organizational_unit_guard_key_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.unit_key IS DISTINCT FROM OLD.unit_key THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'organizational unit key is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS organizational_unit_key_immutable ON organizational_units;
CREATE TRIGGER organizational_unit_key_immutable
BEFORE UPDATE ON organizational_units
FOR EACH ROW EXECUTE FUNCTION organizational_unit_guard_key_immutable();

CREATE OR REPLACE FUNCTION organizational_unit_guard_cycle()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cycle_found boolean;
BEGIN
  IF NEW.parent_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.parent_id = NEW.id THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'organizational unit cannot parent itself';
  END IF;
  WITH RECURSIVE ancestors(id, parent_id) AS (
    SELECT id, parent_id FROM organizational_units WHERE id = NEW.parent_id
    UNION ALL
    SELECT u.id, u.parent_id
    FROM organizational_units u
    JOIN ancestors a ON u.id = a.parent_id
  )
  SELECT EXISTS(SELECT 1 FROM ancestors WHERE id = NEW.id) INTO cycle_found;
  IF cycle_found THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'organizational unit hierarchy cycle';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS organizational_unit_cycle_guard ON organizational_units;
CREATE CONSTRAINT TRIGGER organizational_unit_cycle_guard
AFTER INSERT OR UPDATE OF parent_id ON organizational_units
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION organizational_unit_guard_cycle();
