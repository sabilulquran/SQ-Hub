import { randomUUID } from "node:crypto";

import { loadFoundationConfig } from "../config.js";
import { createPool } from "./pool.js";

const config = loadFoundationConfig();
const pool = createPool(config.databaseUrl);

try {
  await pool.query(
    `
      INSERT INTO applications (
        id, application_key, name, canonical_url, status
      ) VALUES ($1, 'hcis', 'HCIS', $2, 'active')
      ON CONFLICT (application_key) DO UPDATE SET
        name = EXCLUDED.name,
        canonical_url = EXCLUDED.canonical_url,
        updated_at = now()
    `,
    [randomUUID(), config.hcisCanonicalUrl],
  );
  console.log(`seeded hcis -> ${config.hcisCanonicalUrl}`);
} finally {
  await pool.end();
}
