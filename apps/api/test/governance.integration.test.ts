import pg from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { PgApplicationAccessRepository } from "../src/modules/application-access/repository.js";
import { ApplicationAccessService } from "../src/modules/application-access/service.js";
import {
  GovernanceService,
  PgGovernanceApplicationSource,
  PgGovernanceObservationStore,
} from "../src/modules/governance/service.js";
import type { HubSessionRecord } from "../src/modules/hub-auth/repository.js";
import { PgOrganMembershipRepository } from "../src/modules/organ-membership/repository.js";
import { summaryFor } from "./governance.fixture.js";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for integration tests");

const pool = new Pool({ connectionString: databaseUrl });
const access = new ApplicationAccessService(new PgApplicationAccessRepository(pool));
const memberships = new PgOrganMembershipRepository(pool);
const actor = { kind: "human" as const, ref: "staff:synthetic-admin" };
const issuer = "https://login.example.test/realms/sq-staff";
const identity = { issuer, subject: "member-subject" };
const session: HubSessionRecord = {
  sessionId: "session-integration", ...identity, displayName: "Pengurus Sintetis", username: null, email: null,
  emailVerified: null, accountRefreshTokenCiphertext: "sealed",
  createdAt: new Date("2026-10-17T00:00:00Z"), expiresAt: new Date("2026-10-17T12:00:00Z"),
};
const governance = (key: string, order: number) => ({ summaryPath: "/api/governance/summary", audience: `${key}-client`, order });

beforeEach(async () => {
  await pool.query(
    "TRUNCATE governance_summary_observations, organ_memberships, platform_audit_events, application_access, applications CASCADE",
  );
  await access.upsertApplication({ applicationKey: "hcis", name: "HCIS", canonicalUrl: "https://hcis.example.test", status: "active", governance: governance("hcis", 2), actor });
  await access.upsertApplication({ applicationKey: "aset", name: "Aset SQ", canonicalUrl: "https://aset.example.test", status: "active", governance: governance("aset", 1), actor });
  await access.upsertApplication({ applicationKey: "karir", name: "Karir SQ", canonicalUrl: "https://karir.example.test", status: "inactive", governance: governance("karir", 3), actor });
  await access.upsertApplication({ applicationKey: "spmb", name: "SPMB", canonicalUrl: "https://spmb.example.test", status: "active", actor });
  for (const key of ["hcis", "aset", "karir", "spmb"]) await access.grant({ identity, applicationKey: key, reason: "uji", actor });
});

afterAll(async () => {
  await pool.end();
});

describe("Governance application selection (AC 4)", () => {
  it("lists only active applications with a summary path and active access, in governance order", async () => {
    const source = new PgGovernanceApplicationSource(pool);
    expect((await source.listForIdentity(identity)).map((app) => app.applicationKey)).toEqual(["aset", "hcis"]);
    await access.revoke({ identity, applicationKey: "aset", reason: "uji", actor });
    expect((await source.listForIdentity(identity)).map((app) => app.applicationKey)).toEqual(["hcis"]);
    expect(await source.listForIdentity({ issuer, subject: "someone-else" })).toEqual([]);
  });
});

describe("Summary bodies are never persisted (AC 7)", () => {
  it("stores only the last outcome per application, never figures, labels or tokens", async () => {
    await memberships.create({
      identity, terms: { organ: "pengurus", positionLabel: null, termStart: "2020-01-01", termEnd: null },
      reason: "SK", provisioningPath: "existing_staff", actor,
    });
    const service = new GovernanceService({
      memberships,
      applications: new PgGovernanceApplicationSource(pool),
      userAccessToken: async () => "hub-user-token",
      exchanger: { exchange: async (_subject, audience) => `exchanged-${audience}` },
      fetch: (async (input: string | URL) => {
        const url = new URL(String(input));
        const key = url.hostname.split(".")[0]!;
        return key === "aset"
          ? new Response("{}", { status: 403, headers: { "content-type": "application/json" } })
          : new Response(JSON.stringify(summaryFor(key, url.origin)), { status: 200, headers: { "content-type": "application/json" } });
      }) as typeof fetch,
      observations: new PgGovernanceObservationStore(pool),
    });
    const snapshot = await service.snapshot(session, "opaque");
    expect(snapshot.cards.map((card) => card.applicationKey)).toEqual(["hcis"]);

    const observations = await new PgGovernanceObservationStore(pool).list(identity);
    expect(observations.map((row) => `${row.applicationKey}:${row.outcome}`).sort()).toEqual(["aset:forbidden", "hcis:ready"]);

    const dump = JSON.stringify((await pool.query(`
      SELECT (SELECT json_agg(t) FROM governance_summary_observations t) AS observations,
             (SELECT json_agg(t) FROM platform_audit_events t) AS audit,
             (SELECT json_agg(t) FROM organ_memberships t) AS memberships
    `)).rows);
    for (const fragment of ["Pegawai aktif", "Kontrak berakhir", "exchanged-", "hub-user-token", "/board"]) {
      expect(dump).not.toContain(fragment);
    }
  });
});
