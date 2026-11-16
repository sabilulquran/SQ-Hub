-- ADR-0011 amendment 2026-11-16: Kirim SQ is also the WhatsApp API gateway for applications
-- outside SQ Core. The registry records which kind an application is: `modul` (an SQ Core
-- module) or `luar` (an outside application such as Samijaya). The kind is a label for the
-- Kirim card and the documentation only; cards, numbers and consumer rules are the same for both.
-- Additive: existing rows become `modul`. Rolling the application back is safe: older code
-- ignores the column. Recovery plan: dump the Hub database before migrating.
ALTER TABLE applications ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'modul';
ALTER TABLE applications DROP CONSTRAINT IF EXISTS applications_kind_check;
ALTER TABLE applications ADD CONSTRAINT applications_kind_check CHECK (kind IN ('modul', 'luar'));
