import pg from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

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
