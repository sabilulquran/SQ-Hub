import pg from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { PgApplicationAccessRepository, makeAccessTargetRef } from "../src/modules/application-access/repository.js";
import { ApplicationAccessService } from "../src/modules/application-access/service.js";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for integration tests");

const pool = new Pool({ connectionString: databaseUrl });
const repository = new PgApplicationAccessRepository(pool);
const service = new ApplicationAccessService(repository);
const actor = { kind: "human" as const, ref: "test:operator" };
const stagingUrl = "https://hcis-staging.sabilulquran.or.id";

beforeEach(async () => {
  await pool.query("TRUNCATE platform_audit_events, application_access, applications CASCADE");
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
