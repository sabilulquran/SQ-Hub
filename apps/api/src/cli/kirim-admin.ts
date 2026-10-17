import { randomUUID } from "node:crypto";

import { createPool } from "../db/pool.js";
import { findConsumerByName, findDevice, listConsumers, listDevices, withTransaction, writeAudit } from "../modules/kirim/repository.js";
import { isAllowedWebhookUrl } from "../modules/kirim/webhooks.js";

/**
 * KIRIM-IMPL-001 §7.2 and D-2/D-4: operator CLI, run on request of the Kepala HCM.
 * Grants `kirim_admin`, registers consumers and routes. Every change writes kirim_audit.
 * Secrets are never passed here: `--secret-ref` names the env variable that holds them.
 */

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const pool = createPool(databaseUrl);
const args = process.argv.slice(2);

function value(name: string, required = true): string | undefined {
  const index = args.indexOf(name);
  const found = index >= 0 ? args[index + 1] : undefined;
  if (required && (!found || found.startsWith("--"))) throw new Error(`Missing ${name}`);
  return found;
}

function operator(): string {
  return value("--actor", false) ?? `operator:${process.env.USER ?? process.env.USERNAME ?? "cli"}`;
}

async function main() {
  const [area, action] = args;

  if (area === "grant" || area === "revoke") {
    const issuer = value("--issuer")!.replace(/\/$/, "");
    const subject = value("--sub")!;
    const reason = value("--reason")!;
    await withTransaction(pool, async (client) => {
      if (area === "grant") {
        await client.query(
          `INSERT INTO kirim_admins (id, identity_issuer, identity_subject, granted_by, alasan) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (identity_issuer, identity_subject) WHERE revoked_at IS NULL DO NOTHING`,
          [randomUUID(), issuer, subject, operator(), reason],
        );
      } else {
        await client.query(
          "UPDATE kirim_admins SET revoked_at = now() WHERE identity_issuer = $1 AND identity_subject = $2 AND revoked_at IS NULL",
          [issuer, subject],
        );
      }
      await writeAudit(client, {
        actorKind: "human",
        actorRef: operator(),
        aksi: area === "grant" ? "admin.tambah" : "admin.cabut",
        objekJenis: "kirim_admin",
        objekRef: `${issuer}#${subject}`,
        metadata: { alasan: reason },
      });
    });
    console.log(`${area === "grant" ? "granted" : "revoked"} kirim_admin`);
    return;
  }

  if (area === "admin" && action === "list") {
    const result = await pool.query(
      `SELECT identity_issuer AS issuer, identity_subject AS sub, granted_by, granted_at, revoked_at FROM kirim_admins ORDER BY granted_at`,
    );
    console.log(JSON.stringify(result.rows, null, 2));
    return;
  }

  if (area === "consumer" && action === "list") {
    console.log(JSON.stringify(await listConsumers(pool), null, 2));
    return;
  }

  if (area === "consumer" && (action === "add" || action === "set")) {
    const nama = value("--nama")!;
    const webhookUrl = value("--webhook-url", false);
    const secretRef = value("--secret-ref", false);
    const quota = value("--kuota", false);
    const active = value("--aktif", false);
    if (webhookUrl !== undefined && !isAllowedWebhookUrl(webhookUrl)) {
      throw new Error("--webhook-url must be http://127.0.0.1:<port>/… or https://<host>.sabilulquran.or.id/… (D-4)");
    }
    if (secretRef !== undefined && !/^KIRIM_CONSUMER_SECRET_[A-Z0-9_]{1,64}$/.test(secretRef)) {
      throw new Error("--secret-ref must name an env variable KIRIM_CONSUMER_SECRET_<NAMA>; never pass the secret itself");
    }
    if (active !== undefined && active !== "true" && active !== "false") throw new Error("--aktif must be true or false");
    await withTransaction(pool, async (client) => {
      if (action === "add") {
        await client.query(
          `INSERT INTO kirim_consumers (id, client_id, nama, webhook_url, webhook_secret_ref, kuota_harian)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [randomUUID(), value("--client-id")!, nama, webhookUrl ?? null, secretRef ?? null, quota ? Number(quota) : 500],
        );
      } else {
        const existing = await findConsumerByName(client, nama);
        if (!existing) throw new Error(`Unknown consumer ${nama}`);
        await client.query(
          `UPDATE kirim_consumers SET webhook_url = $2, webhook_secret_ref = $3, kuota_harian = $4, aktif = $5, updated_at = now() WHERE id = $1`,
          [
            existing.id,
            webhookUrl ?? existing.webhookUrl,
            secretRef ?? existing.webhookSecretRef,
            quota ? Number(quota) : existing.kuotaHarian,
            active === undefined ? existing.aktif : active === "true",
          ],
        );
      }
      await writeAudit(client, {
        actorKind: "human",
        actorRef: operator(),
        aksi: action === "add" ? "pemakai.tambah" : "pemakai.ubah",
        objekJenis: "consumer",
        objekRef: nama,
        metadata: { alasan: value("--reason")!, ...(active !== undefined ? { aktif: active === "true" } : {}) },
      });
    });
    console.log(`${action === "add" ? "added" : "updated"} consumer ${nama}`);
    return;
  }

  if (area === "route" && (action === "add" || action === "remove")) {
    const consumerName = value("--consumer")!;
    const deviceKode = value("--device")!;
    const jenis = value("--jenis")!;
    if (jenis !== "notifikasi" && jenis !== "kode") throw new Error("--jenis must be notifikasi or kode");
    await withTransaction(pool, async (client) => {
      const consumer = await findConsumerByName(client, consumerName);
      const device = await findDevice(client, deviceKode);
      if (!consumer || !device) throw new Error("Unknown consumer or device");
      if (action === "add") {
        await client.query(
          "INSERT INTO kirim_routes (consumer_id, device_id, jenis) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
          [consumer.id, device.id, jenis],
        );
      } else {
        await client.query("DELETE FROM kirim_routes WHERE consumer_id = $1 AND device_id = $2 AND jenis = $3", [consumer.id, device.id, jenis]);
      }
      await writeAudit(client, {
        actorKind: "human",
        actorRef: operator(),
        aksi: action === "add" ? "rute.tambah" : "rute.hapus",
        objekJenis: "route",
        objekRef: `${consumerName}:${deviceKode}:${jenis}`,
        metadata: { alasan: value("--reason")! },
      });
    });
    console.log(`${action === "add" ? "added" : "removed"} route ${consumerName} -> ${deviceKode} (${jenis})`);
    return;
  }

  if (area === "route" && action === "list") {
    const result = await pool.query(
      `SELECT c.nama AS consumer, d.kode AS device, r.jenis FROM kirim_routes r
       JOIN kirim_consumers c ON c.id = r.consumer_id JOIN kirim_devices d ON d.id = r.device_id ORDER BY d.kode, c.nama`,
    );
    console.log(JSON.stringify(result.rows, null, 2));
    return;
  }

  if (area === "device" && action === "list") {
    const devices = (await listDevices(pool)).map((device) => ({
      kode: device.kode,
      label: device.label,
      pemilik: device.pemilik,
      provider: device.provider,
      provider_ref: device.providerRef,
      status: device.status,
      nomor_tersamar: device.nomorTersamar,
      antrean_dijeda: device.antreanDijeda,
    }));
    console.log(JSON.stringify(devices, null, 2));
    return;
  }

  throw new Error(
    [
      "Usage:",
      "  grant  --issuer <issuer> --sub <sub> --reason <text> [--actor <ref>]",
      "  revoke --issuer <issuer> --sub <sub> --reason <text> [--actor <ref>]",
      "  admin list",
      "  consumer list",
      "  consumer add --nama <nama> --client-id <id> [--webhook-url <url> --secret-ref KIRIM_CONSUMER_SECRET_<NAMA>] [--kuota 500] --reason <text>",
      "  consumer set --nama <nama> [--webhook-url <url>] [--secret-ref <env>] [--kuota <n>] [--aktif true|false] --reason <text>",
      "  route add|remove --consumer <nama> --device <kode> --jenis notifikasi|kode --reason <text>",
      "  route list",
      "  device list",
    ].join("\n"),
  );
}

try {
  await main();
} finally {
  await pool.end();
}
