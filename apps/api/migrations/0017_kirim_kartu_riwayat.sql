-- KIRIM-IMPL-003 §15 (owner, 2026-11-08): a module's data follows the module, not the number. Every number a
-- module's card has pointed to stays readable for that module (its chat history), while sending and events
-- stay with the number on the card now (§14). `sampai`: when the card left that number; messages and media that
-- came after it are not readable (null while the card is on it). Back on the number, `sampai` is cleared.
-- Additive: one table, one trigger, and one row per card that has a number today. No existing row is changed.
-- Recovery plan: dump the Hub database before migrating; this file runs in one transaction (migrate.ts).
-- Rolling the application back is safe: older code ignores the table. To remove:
--   DROP TRIGGER kirim_consumers_kartu_riwayat ON kirim_consumers; DROP FUNCTION kirim_catat_kartu_riwayat();
--   DROP TABLE kirim_kartu_riwayat;

CREATE TABLE IF NOT EXISTS kirim_kartu_riwayat (
  consumer_id uuid NOT NULL REFERENCES kirim_consumers (id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES kirim_devices (id) ON DELETE CASCADE,
  sejak timestamptz NOT NULL DEFAULT now(),
  sampai timestamptz NULL,
  PRIMARY KEY (consumer_id, device_id)
);
CREATE INDEX IF NOT EXISTS kirim_kartu_riwayat_device_idx ON kirim_kartu_riwayat (device_id);

CREATE OR REPLACE FUNCTION kirim_catat_kartu_riwayat() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.nomor_device_id IS NOT NULL AND OLD.nomor_device_id IS DISTINCT FROM NEW.nomor_device_id THEN
    UPDATE kirim_kartu_riwayat SET sampai = now() WHERE consumer_id = NEW.id AND device_id = OLD.nomor_device_id;
  END IF;
  IF NEW.nomor_device_id IS NOT NULL THEN
    INSERT INTO kirim_kartu_riwayat (consumer_id, device_id) VALUES (NEW.id, NEW.nomor_device_id)
    ON CONFLICT (consumer_id, device_id) DO UPDATE SET sampai = NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS kirim_consumers_kartu_riwayat ON kirim_consumers;
CREATE TRIGGER kirim_consumers_kartu_riwayat
  AFTER INSERT OR UPDATE OF nomor_device_id ON kirim_consumers
  FOR EACH ROW EXECUTE FUNCTION kirim_catat_kartu_riwayat();

INSERT INTO kirim_kartu_riwayat (consumer_id, device_id)
SELECT id, nomor_device_id FROM kirim_consumers WHERE nomor_device_id IS NOT NULL
ON CONFLICT (consumer_id, device_id) DO NOTHING;
