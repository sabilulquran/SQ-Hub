import pg from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { MachineClientInUseError, PgApplicationAccessRepository, makeAccessTargetRef } from "../src/modules/application-access/repository.js";
import { ApplicationAccessService } from "../src/modules/application-access/service.js";
import { listWhatsAppApplications } from "../src/modules/kirim/repository.js";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for integration tests");

const pool = new Pool({ connectionString: databaseUrl });
const repository = new PgApplicationAccessRepository(pool);
const service = new ApplicationAccessService(repository);
const actor = { kind: "human" as const, ref: "test:operator" };
const stagingUrl = "https://hcis-staging.sabilulquran.or.id";

beforeEach(async () => {
  await pool.query("TRUNCATE platform_audit_events, application_access, applications, kirim_consumers CASCADE");
  await service.upsertApplication({
    applicationKey: "hcis",
    name: "HCIS",
    canonicalUrl: stagingUrl,
    status: "active",
    actor,
  });
});

afterAll(async () => {
  await pool.end();
});

describe("Application Access", () => {
  it("stores the environment-local canonical URL for the application registry", async () => {
    await expect(service.listApplications()).resolves.toEqual([
      expect.objectContaining({
        applicationKey: "hcis",
        canonicalUrl: stagingUrl,
        status: "active",
      }),
    ]);
  });

  it("returns UNKNOWN_APPLICATION for an unregistered application", async () => {
    await expect(
      service.checkAccess(
        {
          issuer: "https://login.sabilulquran.or.id/realms/sq-staff-staging",
          subject: "user-unknown-app",
        },
        "spmb",
      ),
    ).resolves.toEqual({
      allowed: false,
      applicationKey: "spmb",
      decision: "UNKNOWN_APPLICATION",
    });
  });

  it("denies, grants, then revokes one exact issuer+subject", async () => {
    const identity = {
      issuer: "https://login.sabilulquran.or.id/realms/sq-staff-staging",
      subject: "user-001",
    };

    await expect(service.checkAccess(identity, "hcis")).resolves.toMatchObject({
      allowed: false,
      decision: "NO_GRANT",
    });

    await service.grant({ identity, applicationKey: "hcis", actor, reason: "wave-1-test" });
    await expect(service.checkAccess(identity, "hcis")).resolves.toEqual({
      allowed: true,
      applicationKey: "hcis",
      decision: "active_grant",
    });

    await service.revoke({ identity, applicationKey: "hcis", actor, reason: "test-revoke" });
    await expect(service.checkAccess(identity, "hcis")).resolves.toMatchObject({
      allowed: false,
      decision: "GRANT_REVOKED",
    });
  });

  it("keeps grant and revoke operations idempotent at the current-state level", async () => {
    const identity = {
      issuer: "https://login.sabilulquran.or.id/realms/sq-staff-staging",
      subject: "user-idempotent",
    };

    await service.grant({ identity, applicationKey: "hcis", actor });
    await service.grant({ identity, applicationKey: "hcis", actor });
    const granted = await service.getAccess(identity, "hcis");
    expect(granted).toMatchObject({ status: "active" });

    await service.revoke({ identity, applicationKey: "hcis", actor });
    await service.revoke({ identity, applicationKey: "hcis", actor });
    const revoked = await service.getAccess(identity, "hcis");
    expect(revoked).toMatchObject({ status: "revoked" });

    const count = await pool.query<{ count: string }>(
      `
        SELECT count(*)::text AS count
        FROM application_access aa
        JOIN applications a ON a.id = aa.application_id
        WHERE aa.identity_issuer = $1
          AND aa.identity_subject = $2
          AND a.application_key = 'hcis'
      `,
      [identity.issuer, identity.subject],
    );
    expect(count.rows[0]?.count).toBe("1");
  });

  it("does not collide the same subject from a different issuer", async () => {
    const allowed = {
      issuer: "https://login.sabilulquran.or.id/realms/sq-staff-staging",
      subject: "same-sub",
    };
    const otherIssuer = {
      issuer: "https://example.invalid/realms/other",
      subject: "same-sub",
    };

    await service.grant({ identity: allowed, applicationKey: "hcis", actor });
    await expect(service.checkAccess(allowed, "hcis")).resolves.toMatchObject({ allowed: true });
    await expect(service.checkAccess(otherIssuer, "hcis")).resolves.toMatchObject({
      allowed: false,
      decision: "NO_GRANT",
    });
  });

  it("denies access when the application is inactive", async () => {
    const identity = {
      issuer: "https://login.sabilulquran.or.id/realms/sq-staff-staging",
      subject: "user-002",
    };
    await service.grant({ identity, applicationKey: "hcis", actor });
    await service.upsertApplication({
      applicationKey: "hcis",
      name: "HCIS",
      canonicalUrl: stagingUrl,
      status: "inactive",
      actor,
    });

    await expect(service.checkAccess(identity, "hcis")).resolves.toMatchObject({
      allowed: false,
      decision: "APPLICATION_INACTIVE",
    });
  });

  it("writes an audit trail for application and access mutations", async () => {
    const identity = {
      issuer: "https://login.sabilulquran.or.id/realms/sq-staff-staging",
      subject: "user-003",
    };
    await service.grant({ identity, applicationKey: "hcis", actor, reason: "needed" });
    await service.revoke({ identity, applicationKey: "hcis", actor, reason: "removed" });

    const targetRef = makeAccessTargetRef(identity, "hcis");
    const audit = await service.listAudit(targetRef, 10);
    expect(audit.map((item) => item.action)).toEqual([
      "application_access.revoke",
      "application_access.grant",
    ]);
  });
});

// ADR-0011 amendment 2026-11-16: applications outside SQ Core are registered from the GUI and get
// a Kirim SQ card like a module (KIRIM-IMPL-003 K-2), through the same registry upsert.
describe("Application registry: kind and WhatsApp lewat Kirim", () => {
  const samijaya = { applicationKey: "samijaya", name: "Samijaya", canonicalUrl: "https://samijaya.example.test", status: "active" as const, actor };

  it("stores kind luar with the machine client and lists the application for a Kirim card", async () => {
    const stored = await service.upsertApplication({ ...samijaya, kind: "luar", whatsapp: { capable: true, machineClientId: "samijaya" } });
    expect(stored).toMatchObject({ kind: "luar", whatsappCapable: true, machineClientId: "samijaya" });
    await expect(listWhatsAppApplications(pool)).resolves.toEqual([
      expect.objectContaining({ applicationKey: "samijaya", name: "Samijaya", machineClientId: "samijaya", status: "active", kind: "luar" }),
    ]);
    // The existing module stays `modul` and off the Kirim list.
    const hcis = (await service.listApplications()).find((application) => application.applicationKey === "hcis");
    expect(hcis).toMatchObject({ kind: "modul", whatsappCapable: false, machineClientId: null });
  });

  it("keeps the stored kind and WhatsApp registration when an upsert leaves them out", async () => {
    await service.upsertApplication({ ...samijaya, kind: "luar", whatsapp: { capable: true, machineClientId: "samijaya" } });
    const again = await service.upsertApplication({ ...samijaya, name: "Samijaya Store" });
    expect(again).toMatchObject({ name: "Samijaya Store", kind: "luar", whatsappCapable: true, machineClientId: "samijaya" });
    const off = await service.upsertApplication({ ...samijaya, whatsapp: { capable: false, machineClientId: null } });
    expect(off).toMatchObject({ kind: "luar", whatsappCapable: false, machineClientId: null });
    await expect(listWhatsAppApplications(pool)).resolves.toEqual([]);
  });

  it("refuses WhatsApp without a machine client and a client id that another application holds", async () => {
    await expect(service.upsertApplication({ ...samijaya, whatsapp: { capable: true, machineClientId: null } })).rejects.toThrow();
    await service.upsertApplication({ ...samijaya, whatsapp: { capable: true, machineClientId: "samijaya" } });
    await expect(
      service.upsertApplication({ applicationKey: "toko-lain", name: "Toko lain", canonicalUrl: "https://toko.example.test", status: "active", actor, whatsapp: { capable: true, machineClientId: "samijaya" } }),
    ).rejects.toBeInstanceOf(MachineClientInUseError);
    // The refused upsert left nothing behind.
    expect((await service.listApplications()).map((application) => application.applicationKey)).toEqual(["hcis", "samijaya"]);
  });

  it("moves the application's Kirim consumer to the new machine client", async () => {
    await service.upsertApplication({ ...samijaya, whatsapp: { capable: true, machineClientId: "samijaya" } });
    await pool.query("INSERT INTO kirim_consumers (id, client_id, nama, application_key) VALUES (gen_random_uuid(), 'samijaya', 'samijaya', 'samijaya')");
    await service.upsertApplication({ ...samijaya, whatsapp: { capable: true, machineClientId: "samijaya-api" } });
    const consumer = await pool.query<{ client_id: string }>("SELECT client_id FROM kirim_consumers WHERE application_key = 'samijaya'");
    expect(consumer.rows[0]?.client_id).toBe("samijaya-api");
  });

  it("audits the kind and WhatsApp fields of the upsert without a secret", async () => {
    await service.upsertApplication({ ...samijaya, kind: "luar", whatsapp: { capable: true, machineClientId: "samijaya" } });
    const audit = await service.listAudit("samijaya", 5);
    expect(audit[0]).toMatchObject({ action: "application.upsert", payload: { kind: "luar", whatsappCapable: true, machineClientId: "samijaya" } });
  });
});
