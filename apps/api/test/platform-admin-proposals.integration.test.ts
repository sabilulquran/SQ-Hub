import pg from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { HubSessionRecord } from "../src/modules/hub-auth/repository.js";
import { PgPlatformAdminProposalRepository } from "../src/modules/platform-admin/proposals.js";
import { makePlatformAdminTargetRef, PgPlatformAdminRepository } from "../src/modules/platform-admin/repository.js";
import { PlatformAdminService } from "../src/modules/platform-admin/service.js";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for integration tests");

const pool = new Pool({ connectionString: databaseUrl });
const service = new PlatformAdminService(new PgPlatformAdminRepository(pool), new PgPlatformAdminProposalRepository(pool));
const issuer = "https://login.example.test/realms/sq-staff";
const bootstrap = { kind: "system" as const, ref: "test:bootstrap" };

const adminA = { issuer, subject: "admin-a" };
const adminB = { issuer, subject: "admin-b" };
const target = { issuer, subject: "staff-c" };

function session(identity: { issuer: string; subject: string }): HubSessionRecord {
  return {
    sessionId: `session-${identity.subject}`,
    ...identity,
    displayName: identity.subject,
    username: identity.subject,
    email: `${identity.subject}@example.test`,
    emailVerified: true,
    accountRefreshTokenCiphertext: null,
    // Created after every grant in these tests, so freshness never interferes.
    createdAt: new Date(Date.now() + 60 * 60 * 1000),
    expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
  };
}

async function isActive(identity: { issuer: string; subject: string }) {
  return (await service.show(identity))?.status === "active";
}

beforeEach(async () => {
  await pool.query("TRUNCATE platform_admin_proposals, platform_administrators, platform_audit_events CASCADE");
  await service.grant({ identity: adminA, reason: "bootstrap", actor: bootstrap });
  await service.grant({ identity: adminB, reason: "bootstrap", actor: bootstrap });
});

afterAll(async () => {
  await pool.end();
});

describe("H-9: making someone an active Platform Administrator takes two different administrators (AC 9)", () => {
  it("activates only when a second administrator confirms", async () => {
    const proposal = await service.propose(session(adminA), { identity: target, reason: "SK Pengurus 4/2026" });
    expect(proposal.status).toBe("pending");
    expect(await isActive(target)).toBe(false);

    const result = await service.confirm(session(adminB), proposal.id);
    expect(result.proposal).toMatchObject({ status: "confirmed", decidedBy: adminB });
    expect(await isActive(target)).toBe(true);

    const audit = await pool.query<{ action: string; actor_ref: string; payload: Record<string, unknown> }>(
      "SELECT action, actor_ref, payload FROM platform_audit_events WHERE target_ref = $1 ORDER BY occurred_at",
      [makePlatformAdminTargetRef(target)],
    );
    expect(audit.rows.map((row) => row.action)).toEqual(["platform_admin.propose", "platform_admin.grant"]);
    expect(audit.rows[1]!.payload).toMatchObject({ proposalId: proposal.id, proposedBy: makePlatformAdminTargetRef(adminA) });
  });

  it("refuses the proposer confirming their own proposal", async () => {
    const proposal = await service.propose(session(adminA), { identity: target, reason: "reason" });
    await expect(service.confirm(session(adminA), proposal.id)).rejects.toMatchObject({ code: "SAME_ADMIN_FORBIDDEN" });
    expect(await isActive(target)).toBe(false);
  });

  it("refuses proposing oneself", async () => {
    await service.revoke({ identity: adminB, reason: "test", actor: bootstrap });
    // A revoked administrator cannot even reach the proposal; an active one cannot name themselves.
    await expect(service.propose(session(adminB), { identity: adminB, reason: "me" })).rejects.toMatchObject({ code: "ADMIN_FORBIDDEN" });
    await expect(service.propose(session(adminA), { identity: adminA, reason: "me" })).rejects.toMatchObject({ code: "SELF_PROPOSAL_FORBIDDEN" });
  });

  it("closes revoke-then-reactivate: reactivation needs a fresh proposal and a second person", async () => {
    const first = await service.propose(session(adminA), { identity: target, reason: "first" });
    await service.confirm(session(adminB), first.id);
    await service.revokeBySession(session(adminA), { identity: target, reason: "revoked alone, which is allowed" });
    expect(await isActive(target)).toBe(false);

    // The confirmed proposal cannot be replayed, and A alone cannot bring the target back.
    await expect(service.confirm(session(adminB), first.id)).rejects.toMatchObject({ code: "PROPOSAL_NOT_PENDING" });
    const second = await service.propose(session(adminA), { identity: target, reason: "again" });
    await expect(service.confirm(session(adminA), second.id)).rejects.toMatchObject({ code: "SAME_ADMIN_FORBIDDEN" });
    expect(await isActive(target)).toBe(false);
  });

  it("refuses the target confirming their own proposal", async () => {
    // A proposal for B while B is revoked, then B is reactivated by the bootstrap path.
    await service.revoke({ identity: adminB, reason: "test", actor: bootstrap });
    const proposal = await service.propose(session(adminA), { identity: adminB, reason: "back" });
    await service.grant({ identity: adminB, reason: "bootstrap again", actor: bootstrap });
    await expect(service.confirm(session(adminB), proposal.id)).rejects.toMatchObject({ code: "SELF_CONFIRM_FORBIDDEN" });
  });

  it("does not count a proposal whose proposer has since lost the role", async () => {
    const proposal = await service.propose(session(adminA), { identity: target, reason: "reason" });
    await service.revokeBySession(session(adminB), { identity: adminA, reason: "left" });
    await expect(service.confirm(session(adminB), proposal.id)).rejects.toMatchObject({ code: "PROPOSER_NOT_ACTIVE" });
    expect(await isActive(target)).toBe(false);
  });

  it("refuses an expired proposal and lets a new one replace it", async () => {
    const proposal = await service.propose(session(adminA), { identity: target, reason: "reason" });
    await pool.query("UPDATE platform_admin_proposals SET created_at = now() - interval '8 days', expires_at = now() - interval '1 day' WHERE id = $1", [proposal.id]);
    await expect(service.confirm(session(adminB), proposal.id)).rejects.toMatchObject({ code: "PROPOSAL_EXPIRED" });
    const fresh = await service.propose(session(adminB), { identity: target, reason: "again" });
    expect(fresh.status).toBe("pending");
    await service.confirm(session(adminA), fresh.id);
    expect(await isActive(target)).toBe(true);
  });

  it("keeps one pending proposal per person and refuses proposing an active administrator", async () => {
    await service.propose(session(adminA), { identity: target, reason: "one" });
    await expect(service.propose(session(adminB), { identity: target, reason: "two" })).rejects.toMatchObject({ code: "PROPOSAL_PENDING" });
    await expect(service.propose(session(adminA), { identity: adminB, reason: "already" })).rejects.toMatchObject({ code: "ALREADY_ACTIVE" });
  });

  it("lets a cancelled proposal never activate", async () => {
    const proposal = await service.propose(session(adminA), { identity: target, reason: "reason" });
    await service.cancel(session(adminA), proposal.id);
    await expect(service.confirm(session(adminB), proposal.id)).rejects.toMatchObject({ code: "PROPOSAL_NOT_PENDING" });
  });

  it("refuses every change from someone who is not an active Platform Administrator", async () => {
    const outsider = { issuer, subject: "staff-d" };
    const proposal = await service.propose(session(adminA), { identity: target, reason: "reason" });
    await expect(service.confirm(session(outsider), proposal.id)).rejects.toMatchObject({ code: "ADMIN_FORBIDDEN" });
    await expect(service.cancel(session(outsider), proposal.id)).rejects.toMatchObject({ code: "ADMIN_FORBIDDEN" });
    await expect(service.overview(session(outsider))).rejects.toMatchObject({ code: "ADMIN_FORBIDDEN" });
    await expect(service.revokeBySession(session(outsider), { identity: adminA, reason: "x" })).rejects.toMatchObject({ code: "ADMIN_FORBIDDEN" });
  });

  it("enforces the four-eyes rule in the database too", async () => {
    const proposal = await service.propose(session(adminA), { identity: target, reason: "reason" });
    await expect(pool.query(
      "UPDATE platform_admin_proposals SET status = 'confirmed', decided_issuer = $2, decided_subject = $3, decided_at = now() WHERE id = $1",
      [proposal.id, adminA.issuer, adminA.subject],
    )).rejects.toMatchObject({ code: "23514" });
  });
});

describe("H-11: the list of Platform Administrators and its changes are readable without the database", () => {
  it("lists administrators, proposals and the platform_admin audit", async () => {
    const proposal = await service.propose(session(adminA), { identity: target, reason: "reason" });
    const overview = await service.overview(session(adminB));
    expect(overview.memberships.map((membership) => `${membership.identity.subject}:${membership.status}`).sort())
      .toEqual(["admin-a:active", "admin-b:active"]);
    expect(overview.proposals.map((entry) => entry.id)).toEqual([proposal.id]);
    const audit = await service.adminAudit(session(adminB), 50);
    expect(audit.map((record) => record.action)).toContain("platform_admin.propose");
  });
});

describe("Admin Center routes for Platform Administrators", () => {
  const hubOrigin = "https://hub.example.test";
  const people: Record<string, string> = { "admin-a": "Admin A", "admin-b": "Admin B", "staff-c": "Pegawai C" };

  async function app(viewer: { issuer: string; subject: string }) {
    const { buildApp } = await import("../src/app.js");
    return buildApp({
      accessService: { checkAccess: async () => ({ allowed: false, applicationKey: "hcis", decision: "no_grant" }) },
      verifyMachineToken: async () => ({ clientId: "unused" }),
      hubAuth: {
        beginLogin: async () => ({ authorizationUrl: new URL(`${issuer}/auth`), setCookie: "" }),
        completeLogin: async () => ({ setCookies: [], returnPath: "/" }),
        getWorkspace: async () => { throw new Error("unused"); },
        getSession: async () => session(viewer),
        getAccountAccess: async () => { throw new Error("unused"); },
        logout: async () => ({ clearCookie: "", logoutUrl: null }),
        clearTransactionCookie: () => "",
      },
      hubRedirectUri: `${hubOrigin}/auth/callback`,
      adminAllowedOrigin: hubOrigin,
      platformAdmin: service,
      platformAdministrators: service,
      identityDirectory: {
        issuer,
        search: async () => [],
        inspect: async (subject) => people[subject]
          ? {
              identity: { issuer, subject },
              username: subject,
              email: null,
              emailVerified: false,
              displayName: people[subject]!,
              enabled: true,
              security: { totpConfigured: null, recoveryCodesConfigured: null },
            }
          : null,
      },
    });
  }

  it("proposes, confirms and shows who did what by name (H-9, H-11)", async () => {
    const asA = await app(adminA);
    const proposed = await asA.inject({
      method: "POST", url: "/admin/platform-administrators/proposals",
      headers: { cookie: "sq_hub_session=x", origin: hubOrigin },
      payload: { subject: "staff-c", reason: "SK 4/2026" },
    });
    expect(proposed.statusCode).toBe(201);
    const proposalId = proposed.json().proposal.id as string;
    const selfConfirm = await asA.inject({
      method: "POST", url: `/admin/platform-administrators/proposals/${proposalId}/confirm`,
      headers: { cookie: "sq_hub_session=x", origin: hubOrigin },
    });
    expect(selfConfirm.statusCode).toBe(403);
    expect(selfConfirm.json()).toEqual({ error: "SAME_ADMIN_FORBIDDEN" });

    const asB = await app(adminB);
    const confirmed = await asB.inject({
      method: "POST", url: `/admin/platform-administrators/proposals/${proposalId}/confirm`,
      headers: { cookie: "sq_hub_session=x", origin: hubOrigin },
    });
    expect(confirmed.statusCode).toBe(200);

    const list = await asB.inject({ method: "GET", url: "/admin/platform-administrators", headers: { cookie: "sq_hub_session=x" } });
    expect(list.json().administrators.map((entry: { person: { displayName: string } }) => entry.person.displayName).sort())
      .toEqual(["Admin A", "Admin B", "Pegawai C"]);

    const audit = await asB.inject({ method: "GET", url: "/admin/platform-administrators/audit", headers: { cookie: "sq_hub_session=x" } });
    const grant = audit.json().audit.find((entry: { action: string; target: { subject: string } | null }) =>
      entry.action === "platform_admin.grant" && entry.target?.subject === "staff-c");
    expect(grant).toMatchObject({
      actor: { subject: "admin-b", displayName: "Admin B" },
      target: { subject: "staff-c", displayName: "Pegawai C" },
      proposedBy: { subject: "admin-a", displayName: "Admin A" },
      reason: "SK 4/2026",
    });
    await asA.close();
    await asB.close();
  });

  it("refuses an employee and a foreign origin", async () => {
    const outsider = await app({ issuer, subject: "staff-d" });
    const list = await outsider.inject({ method: "GET", url: "/admin/platform-administrators", headers: { cookie: "sq_hub_session=x" } });
    expect(list.statusCode).toBe(403);
    await outsider.close();
    const asA = await app(adminA);
    const foreign = await asA.inject({
      method: "POST", url: "/admin/platform-administrators/proposals",
      headers: { cookie: "sq_hub_session=x", origin: "https://evil.example" },
      payload: { subject: "staff-c", reason: "x" },
    });
    expect(foreign.statusCode).toBe(403);
    expect(foreign.json()).toEqual({ error: "ADMIN_ORIGIN_FORBIDDEN" });
    await asA.close();
  });
});
