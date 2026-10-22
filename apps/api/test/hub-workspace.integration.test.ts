import pg from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { PgApplicationAccessRepository } from "../src/modules/application-access/repository.js";
import { ApplicationAccessService } from "../src/modules/application-access/service.js";
import { PgHubWorkspaceRepository } from "../src/modules/hub-auth/workspace-repository.js";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for integration tests");

const pool = new Pool({ connectionString: databaseUrl });
const access = new ApplicationAccessService(new PgApplicationAccessRepository(pool));
const workspace = new PgHubWorkspaceRepository(pool);
const actor = { kind: "human" as const, ref: "test:workspace-operator" };
const identity = {
  issuer: "https://login.sabilulquran.or.id/realms/sq-staff-staging",
  subject: "workspace-subject-001",
};

beforeEach(async () => {
  await pool.query("TRUNCATE platform_audit_events, application_access, applications CASCADE");
  await access.upsertApplication({
    applicationKey: "hcis",
    name: "HCIS",
    canonicalUrl: "https://hcis-staging.sabilulquran.or.id",
    status: "active",
    actor,
  });
  await access.upsertApplication({
    applicationKey: "finance",
    name: "Finance",
    canonicalUrl: "https://finance.example.test",
    status: "active",
    actor,
  });
});

afterAll(async () => {
  await pool.end();
});

describe("authenticated Hub workspace application filtering", () => {
  it("returns only active registry entries with an active grant", async () => {
    await access.grant({ identity, applicationKey: "hcis", actor });

    await expect(workspace.listAuthorizedApplications(identity)).resolves.toEqual([
      {
        applicationKey: "hcis",
        name: "HCIS",
        canonicalUrl: "https://hcis-staging.sabilulquran.or.id",
      },
    ]);
  });

  it("removes a revoked grant without invalidating the identity concept", async () => {
    await access.grant({ identity, applicationKey: "hcis", actor });
    await expect(workspace.listAuthorizedApplications(identity)).resolves.toHaveLength(1);

    await access.revoke({ identity, applicationKey: "hcis", actor, reason: "workspace refresh test" });
    await expect(workspace.listAuthorizedApplications(identity)).resolves.toEqual([]);
  });

  it("does not return inactive applications even when their grant is active", async () => {
    await access.grant({ identity, applicationKey: "hcis", actor });
    await access.upsertApplication({
      applicationKey: "hcis",
      name: "HCIS",
      canonicalUrl: "https://hcis-staging.sabilulquran.or.id",
      status: "inactive",
      actor,
    });

    await expect(workspace.listAuthorizedApplications(identity)).resolves.toEqual([]);
  });
});

describe("HUB-IMPL-022 internal launcher list over the workspace source", () => {
  const app = buildApp({
    accessService: access,
    verifyMachineToken: async () => ({ clientId: "hcis-api-staging" }),
    launcher: { applications: workspace, hubOrigin: "https://hub.sabilulquran.or.id" },
  });

  afterAll(async () => {
    await app.close();
  });

  async function launcherFor(value: { issuer: string; subject: string }) {
    const response = await app.inject({
      method: "POST",
      url: "/internal/v1/application-access/launcher",
      headers: { authorization: "Bearer allowed" },
      payload: { identity: value },
    });
    expect(response.statusCode).toBe(200);
    return response.json() as { applications: Array<{ key: string; name: string; canonicalUrl: string }> };
  }

  it("lists active grants on active applications by name, without SQ Hub, and nothing for an unknown identity", async () => {
    await access.upsertApplication({
      applicationKey: "aset-sq",
      name: "Aset SQ",
      canonicalUrl: "https://aset.sabilulquran.or.id",
      status: "active",
      actor,
    });
    await access.upsertApplication({
      applicationKey: "sq-hub",
      name: "SQ Hub",
      canonicalUrl: "https://hub.sabilulquran.or.id",
      status: "active",
      actor,
    });
    await access.upsertApplication({
      applicationKey: "old-app",
      name: "Aplikasi lama",
      canonicalUrl: "https://old.example.test",
      status: "inactive",
      actor,
    });
    for (const applicationKey of ["hcis", "finance", "aset-sq", "sq-hub", "old-app"]) {
      await access.grant({ identity, applicationKey, actor });
    }
    await access.revoke({ identity, applicationKey: "finance", actor, reason: "launcher test" });

    await expect(launcherFor(identity)).resolves.toEqual({
      applications: [
        { key: "aset-sq", name: "Aset SQ", canonicalUrl: "https://aset.sabilulquran.or.id" },
        { key: "hcis", name: "HCIS", canonicalUrl: "https://hcis-staging.sabilulquran.or.id" },
      ],
    });
    await expect(launcherFor({ ...identity, subject: "nobody-known" })).resolves.toEqual({ applications: [] });
    await expect(launcherFor({ issuer: "https://other.example.test/realms/x", subject: identity.subject })).resolves.toEqual({ applications: [] });
  });
});
