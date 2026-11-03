-- KIRIM-IMPL-003 §3: one Kirim SQ card per registry application. Additive only: no row is
-- deleted and no route changes, so consumers keep sending exactly as before.
-- Recovery plan: dump the Hub database before migrating; this file runs in one transaction.
-- Rolling the application back is safe: older code ignores the new columns.

ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS machine_client_id text NULL,
  ADD COLUMN IF NOT EXISTS whatsapp_capable boolean NOT NULL DEFAULT false;

ALTER TABLE applications DROP CONSTRAINT IF EXISTS applications_machine_client_check;
ALTER TABLE applications ADD CONSTRAINT applications_machine_client_check CHECK (
  (machine_client_id IS NULL OR machine_client_id ~ '^[A-Za-z0-9._:-]{1,255}$')
  AND (NOT whatsapp_capable OR machine_client_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS applications_machine_client_idx
  ON applications (machine_client_id) WHERE machine_client_id IS NOT NULL;

ALTER TABLE kirim_consumers
  ADD COLUMN IF NOT EXISTS application_key text NULL REFERENCES applications (application_key),
  ADD COLUMN IF NOT EXISTS nomor_device_id uuid NULL REFERENCES kirim_devices (id),
  ADD COLUMN IF NOT EXISTS webhook_secret_enc text NULL;
CREATE UNIQUE INDEX IF NOT EXISTS kirim_consumers_application_idx
  ON kirim_consumers (application_key) WHERE application_key IS NOT NULL;

-- A webhook URL needs a secret, kept either in the Hub env (R1) or encrypted here (§6).
ALTER TABLE kirim_consumers DROP CONSTRAINT IF EXISTS kirim_consumers_check;
ALTER TABLE kirim_consumers DROP CONSTRAINT IF EXISTS kirim_consumers_webhook_secret_check;
ALTER TABLE kirim_consumers ADD CONSTRAINT kirim_consumers_webhook_secret_check CHECK (
  (webhook_url IS NULL OR webhook_secret_ref IS NOT NULL OR webhook_secret_enc IS NOT NULL)
  AND (webhook_secret_ref IS NULL OR webhook_url IS NOT NULL)
);

-- Link existing consumers to their registry application: `nama` equals the application key, or
-- the key without its `-sq` suffix (`karir` -> `karir-sq`). Only unambiguous matches.
UPDATE kirim_consumers c
   SET application_key = a.application_key
  FROM applications a
 WHERE c.application_key IS NULL
   AND c.nama IN (a.application_key, regexp_replace(a.application_key, '-sq$', ''))
   AND (SELECT count(*) FROM applications b WHERE c.nama IN (b.application_key, regexp_replace(b.application_key, '-sq$', ''))) = 1
   AND (SELECT count(*) FROM kirim_consumers y WHERE y.nama IN (a.application_key, regexp_replace(a.application_key, '-sq$', ''))) = 1
   AND NOT EXISTS (SELECT 1 FROM kirim_consumers x WHERE x.application_key = a.application_key);

-- Those applications use WhatsApp, with the machine client they already send with.
UPDATE applications a
   SET machine_client_id = c.client_id, whatsapp_capable = true, updated_at = now()
  FROM kirim_consumers c
 WHERE c.application_key = a.application_key
   AND a.machine_client_id IS NULL
   AND c.client_id ~ '^[A-Za-z0-9._:-]{1,255}$'
   AND NOT EXISTS (SELECT 1 FROM applications b WHERE b.machine_client_id = c.client_id);

-- The card's number: the consumer's own active number when it has exactly one ...
UPDATE kirim_consumers c
   SET nomor_device_id = owned.device_id, updated_at = now()
  FROM (SELECT pemilik_consumer_id AS consumer_id, (array_agg(id))[1] AS device_id
          FROM kirim_devices WHERE status <> 'nonaktif'
         GROUP BY pemilik_consumer_id HAVING count(*) = 1) owned
 WHERE owned.consumer_id = c.id AND c.nomor_device_id IS NULL;

-- ... otherwise the only active number it has a route on.
UPDATE kirim_consumers c
   SET nomor_device_id = routed.device_id, updated_at = now()
  FROM (SELECT r.consumer_id, (array_agg(DISTINCT r.device_id))[1] AS device_id
          FROM kirim_routes r JOIN kirim_devices d ON d.id = r.device_id
         WHERE d.status <> 'nonaktif'
         GROUP BY r.consumer_id HAVING count(DISTINCT r.device_id) = 1) routed
 WHERE routed.consumer_id = c.id AND c.nomor_device_id IS NULL
   AND NOT EXISTS (SELECT 1 FROM kirim_devices own WHERE own.pemilik_consumer_id = c.id AND own.status <> 'nonaktif');
