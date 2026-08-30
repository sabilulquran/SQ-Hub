import pg from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { PgApplicationAccessRepository } from "../src/modules/application-access/repository.js";
import { ApplicationAccessService } from "../src/modules/application-access/service.js";
import {
  PgPlatformAdminRepository,
  makePlatformAdminTargetRef,
} from "../src/modules/platform-admin/repository.js";
import { PlatformAdminService } from "../src/modules/platform-admin/service.js";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for integration tests");

const pool = new Pool({ connectionString: databaseUrl });
const platformRepository = new PgPlatformAdminRepository(pool);
const platformAdmin = new PlatformAdminService(platformRepository);
const access = new ApplicationAccessService(new PgApplicationAccessRepository(pool));
const actor = { kind: "human" as const, ref: "test:platform-operator" };
const identity = {
  issuer: "https://login.sabilulquran.or.id/realms/sq-staff-staging",
  subject: "platform-admin-subject",
};

beforeEach(async () => {
  await pool.query(
    "TRUNCATE platform_administrators, hub_sessions, hub_oidc_transactions, platform_audit_events, application_access, applications CASCADE",
  );
  await access.upsertApplication({
    applicationKey: "hcis",
    name: "HCIS",
    canonicalUrl: "https://hcis-staging.sabilulquran.or.id",
    status: "active",
    actor,
  });
});

afterAll(async () => {
  await pool.end();
});

function session(createdAt: Date, overrides: Partial<typeof identity> = {}) {
  return {
    sessionId: "synthetic-session",
    issuer: overrides.issuer ?? identity.issuer,
    subject: overrides.subject ?? identity.subject,
    displayName: "Synthetic Platform Admin",
    createdAt,
    expiresAt: new Date(createdAt.getTime() + 60 * 60 * 1000),
  };
}

describe("SQ Platform Administrator", () => {
  it("denies no membership and the same subject under a different issuer", async () => {
    await expect(
      platformAdmin.authorizeSession(session(new Date())),
    ).resolves.toEqual({ status: "forbidden" });

    await platformAdmin.grant({ identity, reason: "integration grant", actor });
    await expect(
      platformAdmin.authorizeSession(
        session(new Date(Date.now() + 1000), { issuer: "https://example.invalid/other" }),
      ),
    ).resolves.toEqual({ status: "forbidden" });
  });

  it("requires a session created after the latest grant and allows a fresh session", async () => {
    const oldSession = session(new Date(Date.now() - 60_000));
    const granted = await platformAdmin.grant({
      identity,
      reason: "privileged UAT",
      actor,
    });
    expect(granted.outcome).toBe("succeeded");
    expect(granted.membership?.status).toBe("active");

    await expect(platformAdmin.authorizeSession(oldSession)).resolves.toEqual({
      status: "reauth_required",
    });

    const latestGrant = new Date(granted.membership!.grantedAt!);
    await expect(
      platformAdmin.authorizeSession(session(new Date(latestGrant.getTime() + 1))),
    ).resolves.toEqual({ status: "authorized" });
  });

  it("revokes admin authorization immediately without changing Application Access", async () => {
    await access.grant({
      identity,
      applicationKey: "hcis",
      reason: "separate domain access",
      actor,
    });
    const granted = await platformAdmin.grant({ identity, reason: "platform duty", actor });
    const freshSession = session(new Date(new Date(granted.membership!.grantedAt!).getTime() + 1));
    await expect(platformAdmin.authorizeSession(freshSession)).resolves.toEqual({
      status: "authorized",
    });

    await platformAdmin.revoke({ identity, reason: "end platform duty", actor });
    await expect(platformAdmin.authorizeSession(freshSession)).resolves.toEqual({
      status: "forbidden",
    });
    await expect(access.checkAccess(identity, "hcis")).resolves.toMatchObject({
      allowed: true,
      decision: "active_grant",
    });
  });

  it("keeps repeated current-state mutations idempotent and re-grant makes old sessions stale", async () => {
    const first = await platformAdmin.grant({ identity, reason: "first", actor });
    const firstGrantedAt = first.membership?.grantedAt;
    const repeated = await platformAdmin.grant({ identity, reason: "repeat", actor });
    expect(repeated.outcome).toBe("noop");
    expect(repeated.membership?.grantedAt).toBe(firstGrantedAt);

    const freshAfterFirst = session(new Date(new Date(firstGrantedAt!).getTime() + 1));
    await platformAdmin.revoke({ identity, reason: "pause", actor });
    const repeatedRevoke = await platformAdmin.revoke({ identity, reason: "repeat revoke", actor });
    expect(repeatedRevoke.outcome).toBe("noop");

    await new Promise((resolve) => setTimeout(resolve, 5));
    const regranted = await platformAdmin.grant({ identity, reason: "resume", actor });
    expect(regranted.outcome).toBe("succeeded");
    expect(regranted.membership?.grantedAt).not.toBe(firstGrantedAt);
    await expect(platformAdmin.authorizeSession(freshAfterFirst)).resolves.toEqual({
      status: "reauth_required",
    });
  });

  it("writes auditable grant/revoke events without raw identity in the target ref", async () => {
    await platformAdmin.grant({ identity, reason: "needed", actor });
    await platformAdmin.revoke({ identity, reason: "removed", actor });

    const targetRef = makePlatformAdminTargetRef(identity);
    expect(targetRef).not.toContain(identity.subject);
    expect(targetRef).not.toContain(identity.issuer);

    const audit = await pool.query<{ action: string; targetRef: string; payload: Record<string, unknown> }>(
      `
        SELECT action, target_ref AS "targetRef", payload
        FROM platform_audit_events
        WHERE target_type = 'platform_administrator'
          AND target_ref = $1
        ORDER BY occurred_at ASC
      `,
      [targetRef],
    );
    expect(audit.rows.map((row) => row.action)).toEqual([
      "platform_admin.grant",
      "platform_admin.revoke",
    ]);
    expect(JSON.stringify(audit.rows)).not.toContain(identity.subject);
  });

  it("returns only aggregate platform-owned overview data", async () => {
    await access.grant({ identity, applicationKey: "hcis", reason: "overview", actor });
    const overview = await platformAdmin.getOverview();

    expect(overview.applications).toEqual({ total: 1, active: 1, inactive: 0 });
    expect(overview.applicationAccess).toEqual({ total: 1, active: 1, revoked: 0 });
    expect(overview.auditEventsLast24Hours).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(overview)).not.toContain(identity.subject);
  });
});
