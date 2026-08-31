import pg from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { HubSessionRecord } from "../src/modules/hub-auth/repository.js";
import { PgPlatformAdminRepository } from "../src/modules/platform-admin/repository.js";
import {
  PlatformAdminAuthorizationError,
  PlatformAdminService,
} from "../src/modules/platform-admin/service.js";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for integration tests");

const pool = new Pool({ connectionString: databaseUrl });
const service = new PlatformAdminService(new PgPlatformAdminRepository(pool));
const actor = { kind: "human" as const, ref: "test:platform-admin-operator" };
const identity = {
  issuer: "https://login.sabilulquran.or.id/realms/sq-staff-staging",
  subject: "platform-admin-subject-001",
};

beforeEach(async () => {
  await pool.query("TRUNCATE platform_administrators, platform_audit_events CASCADE");
});

afterAll(async () => {
  await pool.end();
});

function session(createdAt: Date, overrides: Partial<HubSessionRecord> = {}): HubSessionRecord {
  return {
    sessionId: "session-platform-admin-001",
    issuer: identity.issuer,
    subject: identity.subject,
    displayName: "Synthetic Platform Admin",
    createdAt,
    expiresAt: new Date(createdAt.getTime() + 12 * 60 * 60 * 1000),
    ...overrides,
  };
}

describe("Platform Admin foundation", () => {
  it("uses exact issuer+sub and requires a session created after the latest grant", async () => {
    const staleSession = session(new Date("2026-08-30T00:00:00Z"));
    const granted = await service.grant({
      identity,
      reason: "synthetic staging UAT",
      actor,
    });

    expect(granted.outcome).toBe("succeeded");
    expect(granted.membership?.status).toBe("active");

    await expect(service.authorize(staleSession)).rejects.toMatchObject({
      code: "ADMIN_REAUTH_REQUIRED",
    });

    const grantTime = new Date(granted.membership!.grantedAt!);
    await expect(service.authorize(session(new Date(grantTime.getTime() + 1)))).resolves.toBeUndefined();

    await expect(
      service.authorize(
        session(new Date(grantTime.getTime() + 1), {
          issuer: "https://login.example.test/realms/other",
        }),
      ),
    ).rejects.toBeInstanceOf(PlatformAdminAuthorizationError);
  });

  it("re-grant creates a new freshness boundary and revoke denies immediately", async () => {
    const first = await service.grant({ identity, reason: "first grant", actor });
    const firstGrantTime = new Date(first.membership!.grantedAt!);
    const onceFresh = session(new Date(firstGrantTime.getTime() + 1));
    await expect(service.authorize(onceFresh)).resolves.toBeUndefined();

    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await service.grant({ identity, reason: "re-grant", actor });
    expect(new Date(second.membership!.grantedAt!).getTime()).toBeGreaterThan(firstGrantTime.getTime());
    await expect(service.authorize(onceFresh)).rejects.toMatchObject({
      code: "ADMIN_REAUTH_REQUIRED",
    });

    const secondGrantTime = new Date(second.membership!.grantedAt!);
    const freshAgain = session(new Date(secondGrantTime.getTime() + 1));
    await expect(service.authorize(freshAgain)).resolves.toBeUndefined();

    const revoked = await service.revoke({ identity, reason: "UAT cleanup", actor });
    expect(revoked.outcome).toBe("succeeded");
    await expect(service.authorize(freshAgain)).rejects.toMatchObject({ code: "ADMIN_FORBIDDEN" });

    const repeated = await service.revoke({ identity, reason: "repeat cleanup", actor });
    expect(repeated.outcome).toBe("noop");
  });

  it("writes auditable mutations without using the raw subject as target_ref", async () => {
    await service.grant({ identity, reason: "audit grant", actor });
    await service.revoke({ identity, reason: "audit revoke", actor });
    const audit = await service.listAudit(identity);

    expect(audit.map((event) => event.action)).toEqual([
      "platform_admin.revoke",
      "platform_admin.grant",
    ]);
    expect(audit.every((event) => event.targetRef.startsWith("platform-admin:"))).toBe(true);
    expect(JSON.stringify(audit)).not.toContain(identity.subject);
  });
});
