import { Writable } from "node:stream";

import { describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { KeycloakTokenExchanger } from "../src/modules/governance/token-exchange.js";
import type { HubSessionRecord } from "../src/modules/hub-auth/repository.js";
import { HubAuthError, type HubAuthRuntime } from "../src/modules/hub-auth/service.js";
import type { PlatformAdminMembership, PlatformAdminRepository } from "../src/modules/platform-admin/repository.js";
import { PlatformAdminService } from "../src/modules/platform-admin/service.js";
import { HcisRoleAdministrationChannel } from "../src/modules/role-administration/channel.js";
import {
  RoleAdministrationService,
  type RoleAdministrationAudit,
  type RoleAdministrationLogEntry,
} from "../src/modules/role-administration/service.js";

const issuer = "https://login.example.test/realms/sq-staff";
const hubOrigin = "https://hub.example.test";
const hcisUrl = "https://hcis.example.test";
const tokenEndpoint = `${issuer}/protocol/openid-connect/token`;

const ACCOUNT_A = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_B = "22222222-2222-4222-8222-222222222222";
const ROLE_ID = "33333333-3333-4333-8333-333333333333";
const ASSIGNMENT_ID = "44444444-4444-4444-8444-444444444444";
const REQUEST_ID = "55555555-5555-4555-8555-555555555555";

function sessionFor(subject: string): HubSessionRecord {
  return {
    sessionId: `session-${subject}`,
    issuer,
    subject,
    displayName: `Synthetic ${subject}`,
    username: subject,
    email: `${subject}@example.test`,
    emailVerified: true,
    accountRefreshTokenCiphertext: "sealed",
    createdAt: new Date("2026-11-01T01:00:00Z"),
    expiresAt: new Date("2026-11-01T12:00:00Z"),
  } as HubSessionRecord;
}

// Cookie value → session. Two ordinary employees (both with HCIS access, which the Hub does not
// even consult here) and one Platform Administrator.
const sessions: Record<string, HubSessionRecord> = {
  "cookie-employee-a": sessionFor("employee-a"),
  "cookie-employee-b": sessionFor("employee-b"),
  "cookie-admin": sessionFor("platform-admin"),
};

function membershipRepository(activeSubjects: string[]): PlatformAdminRepository {
  return {
    getMembership: async (identity) =>
      activeSubjects.includes(identity.subject)
        ? ({
            id: "membership",
            identity,
            status: "active",
            reason: "test",
            actor: { kind: "system", ref: "test" },
            grantedAt: new Date("2026-10-01T00:00:00Z"),
            revokedAt: null,
            updatedAt: new Date("2026-10-01T00:00:00Z"),
          } satisfies PlatformAdminMembership)
        : null,
    grant: async () => { throw new Error("unused"); },
    revoke: async () => { throw new Error("unused"); },
    listAudit: async () => [],
  };
}

function hub(userTokens: string[]): HubAuthRuntime {
  const sessionFromCookie = (token: string | null) => {
    const session = token ? sessions[token] : undefined;
    if (!session) throw new HubAuthError(401, "UNAUTHENTICATED", "no session");
    return session;
  };
  return {
    beginLogin: async () => ({ authorizationUrl: new URL(`${issuer}/auth`), setCookie: "" }),
    completeLogin: async () => ({ setCookies: [], returnPath: "/" }),
    getWorkspace: async () => { throw new Error("unused"); },
    getSession: async (token) => sessionFromCookie(token),
    getAccountAccess: async (token) => {
      const session = sessionFromCookie(token);
      userTokens.push(session.subject);
      return { session, accessToken: `user-access-token-${session.subject}` };
    },
    logout: async () => ({ clearCookie: "", logoutUrl: null }),
    clearTransactionCookie: () => "",
  };
}

type Responder = (request: { method: string; url: string; headers: Headers; body: unknown }) => Response;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const catalogBody = {
  roles: [{
    roleId: ROLE_ID,
    roleKey: "role-from-hcis",
    name: "Peran dari HCIS",
    description: null,
    permissions: ["x.read"],
    allowedScopes: ["organization"],
    mandateRequired: true,
  }],
};

function harness(options: { admins?: string[]; hcis?: Responder; exchangeStatus?: number; configured?: boolean } = {}) {
  const keycloak: Array<{ grantType: string; body: Record<string, string> }> = [];
  const hcis: Array<{ method: string; url: string; headers: Headers; body: unknown }> = [];
  const userTokens: string[] = [];
  const audit: Array<Parameters<RoleAdministrationAudit["record"]>[0]> = [];
  const log: RoleAdministrationLogEntry[] = [];
  let assertionCounter = 0;

  const fakeFetch = (async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    if (url === tokenEndpoint) {
      const body = Object.fromEntries(init.body as URLSearchParams);
      keycloak.push({ grantType: body.grant_type!, body });
      if (body.grant_type === "client_credentials") return json({ access_token: "machine-token-secret", token_type: "Bearer" });
      if (options.exchangeStatus) return json({ error: "invalid_request" }, options.exchangeStatus);
      assertionCounter += 1;
      return json({ access_token: `actor-assertion-secret-${assertionCounter}`, token_type: "Bearer" });
    }
    if (url.startsWith(`${hcisUrl}/internal/v1/role-administration/`)) {
      const request = {
        method: init.method ?? "GET",
        url,
        headers: new Headers(init.headers),
        body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
      };
      hcis.push(request);
      if (options.hcis) return options.hcis(request);
      if (request.method === "GET") return json(catalogBody);
      if (request.method === "POST") return json({ assignmentId: ASSIGNMENT_ID, requestId: (request.body as { requestId: string }).requestId }, 201);
      return new Response(null, { status: 204 });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as unknown as typeof fetch;

  const platformAdmin = new PlatformAdminService(membershipRepository(options.admins ?? ["platform-admin"]));
  const hubAuth = hub(userTokens);
  const service = new RoleAdministrationService({
    authorize: (session) => platformAdmin.authorize(session),
    userAccessToken: async (token) => (await hubAuth.getAccountAccess(token)).accessToken,
    exchanger: new KeycloakTokenExchanger({ issuer, clientId: "sq-hub", clientSecret: "test-only-hub-secret", fetch: fakeFetch }),
    ...(options.configured === false
      ? {}
      : {
          channel: new HcisRoleAdministrationChannel({
            issuer,
            hcisBaseUrl: hcisUrl,
            clientId: "sq-hub-role-administration",
            clientSecret: "test-only-machine-secret",
            fetch: fakeFetch,
          }),
        }),
    audit: { record: async (entry) => { audit.push(entry); } },
    log: (entry) => log.push(entry),
  });

  const logLines: string[] = [];
  const app = buildApp({
    accessService: { checkAccess: async () => ({ allowed: false, applicationKey: "hcis", decision: "no_grant" }) },
    verifyMachineToken: async () => ({ clientId: "unused" }),
    hubAuth,
    hubRedirectUri: `${hubOrigin}/auth/callback`,
    adminAllowedOrigin: hubOrigin,
    platformAdmin,
    roleAdministration: service,
    logStream: new Writable({ write(chunk, _encoding, callback) { logLines.push(String(chunk)); callback(); } }),
  });

  return { app, service, keycloak, hcis, userTokens, audit, log, logLines };
}

function grantRequest(cookie: string, accountId: string, requestId = REQUEST_ID) {
  return {
    method: "POST" as const,
    url: `/admin/hcis-roles/accounts/${accountId}/assignments`,
    headers: { cookie: `sq_hub_session=${cookie}`, origin: hubOrigin },
    payload: { requestId, roleId: ROLE_ID, scopeType: "organization", reason: "Mandat SK 12/2026" },
  };
}

describe("H-0: only a Platform Administrator reaches the HCIS channel, and is checked before any exchange", () => {
  it("refuses two ordinary employees granting each other a role without one exchange request (AC 1b)", async () => {
    const { app, keycloak, hcis, userTokens, log } = harness();

    const aToB = await app.inject(grantRequest("cookie-employee-a", ACCOUNT_B));
    const bToA = await app.inject(grantRequest("cookie-employee-b", ACCOUNT_A, "66666666-6666-4666-8666-666666666666"));

    for (const response of [aToB, bToA]) {
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: "ADMIN_FORBIDDEN" });
    }
    // No token of any kind was requested from Keycloak, no user token was refreshed, HCIS was not called.
    expect(keycloak).toEqual([]);
    expect(userTokens).toEqual([]);
    expect(hcis).toEqual([]);
    expect(log.filter((entry) => entry.event === "role_administration.exchange")).toEqual([]);
    await app.close();
  });

  it("refuses the catalog and a revocation for an employee the same way", async () => {
    const { app, keycloak, hcis } = harness();
    const catalog = await app.inject({ method: "GET", url: "/admin/hcis-roles/catalog", headers: { cookie: "sq_hub_session=cookie-employee-a" } });
    const revoke = await app.inject({
      method: "DELETE",
      url: `/admin/hcis-roles/assignments/${ASSIGNMENT_ID}`,
      headers: { cookie: "sq_hub_session=cookie-employee-a", origin: hubOrigin },
      payload: { requestId: REQUEST_ID },
    });
    expect([catalog.statusCode, revoke.statusCode]).toEqual([403, 403]);
    expect(keycloak).toEqual([]);
    expect(hcis).toEqual([]);
    await app.close();
  });

  it("refuses before validating the body, so a non-admin learns nothing from the input shape", async () => {
    const { app, keycloak } = harness();
    const response = await app.inject({ ...grantRequest("cookie-employee-a", "not-a-uuid"), payload: { anything: true } });
    expect(response.statusCode).toBe(403);
    expect(keycloak).toEqual([]);
    await app.close();
  });

  it("guards the service itself, not only the routes", async () => {
    const { service, keycloak, hcis } = harness();
    await expect(service.grant(sessions["cookie-employee-a"]!, "cookie-employee-a", {
      accountId: ACCOUNT_B, requestId: REQUEST_ID, roleId: ROLE_ID, scopeType: "organization",
      organizationalUnitId: null, reason: null, startsOn: null, endsOn: null,
    })).rejects.toMatchObject({ code: "ADMIN_FORBIDDEN" });
    await expect(service.catalog(sessions["cookie-employee-b"]!, "cookie-employee-b")).rejects.toMatchObject({ code: "ADMIN_FORBIDDEN" });
    await expect(service.revoke(sessions["cookie-employee-b"]!, "cookie-employee-b", { assignmentId: ASSIGNMENT_ID, requestId: REQUEST_ID }))
      .rejects.toMatchObject({ code: "ADMIN_FORBIDDEN" });
    expect(keycloak).toEqual([]);
    expect(hcis).toEqual([]);
  });

  it("refuses an employee even while the channel is not configured", async () => {
    const { app } = harness({ configured: false });
    const employee = await app.inject(grantRequest("cookie-employee-a", ACCOUNT_B));
    const admin = await app.inject(grantRequest("cookie-admin", ACCOUNT_B));
    expect(employee.json()).toEqual({ error: "ADMIN_FORBIDDEN" });
    expect(admin.statusCode).toBe(503);
    expect(admin.json()).toEqual({ error: "ROLE_ADMIN_CHANNEL_NOT_CONFIGURED" });
    await app.close();
  });

  it("refuses a revoked Platform Administrator", async () => {
    const { app, keycloak } = harness({ admins: [] });
    const response = await app.inject(grantRequest("cookie-admin", ACCOUNT_B));
    expect(response.statusCode).toBe(403);
    expect(keycloak).toEqual([]);
    await app.close();
  });
});

describe("H-1/H-2: the Platform Administrator's command to HCIS", () => {
  it("grants with two proofs: a machine token and a fresh actor assertion exchanged by sq-hub", async () => {
    const { app, keycloak, hcis, audit } = harness();
    const response = await app.inject(grantRequest("cookie-admin", ACCOUNT_B));
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ assignmentId: ASSIGNMENT_ID, requestId: REQUEST_ID });

    expect(keycloak.map((call) => call.grantType)).toEqual([
      "client_credentials",
      "urn:ietf:params:oauth:grant-type:token-exchange",
    ]);
    expect(keycloak[0]!.body).toMatchObject({ client_id: "sq-hub-role-administration", scope: "role-administration.manage" });
    expect(keycloak[1]!.body).toMatchObject({
      client_id: "sq-hub",
      subject_token: "user-access-token-platform-admin",
      audience: "hcis-role-administration-actor",
      scope: "role-administration.actor",
    });

    expect(hcis).toHaveLength(1);
    const call = hcis[0]!;
    expect(call.method).toBe("POST");
    expect(call.url).toBe(`${hcisUrl}/internal/v1/role-administration/accounts/${ACCOUNT_B}/role-assignments`);
    expect(call.headers.get("authorization")).toBe("Bearer machine-token-secret");
    expect(call.headers.get("x-sq-actor-assertion")).toBe("actor-assertion-secret-1");
    // Identity never travels in the body (H-2).
    expect(call.body).toEqual({
      requestId: REQUEST_ID, roleId: ROLE_ID, scopeType: "organization", organizationalUnitId: null,
      reason: "Mandat SK 12/2026", startsOn: null, endsOn: null,
    });
    expect(audit).toEqual([expect.objectContaining({
      action: "hcis_role.assignment.create",
      targetRef: `hcis-account:${ACCOUNT_B}`,
      outcome: "succeeded",
      payload: { requestId: REQUEST_ID, roleId: ROLE_ID, scopeType: "organization", assignmentId: ASSIGNMENT_ID },
    })]);
    await app.close();
  });

  it("never lets the actor assertion or machine token reach the browser, the log or the audit (AC 7)", async () => {
    const { app, audit, logLines } = harness();
    const responses = [
      await app.inject({ method: "GET", url: "/admin/hcis-roles/catalog", headers: { cookie: "sq_hub_session=cookie-admin" } }),
      await app.inject(grantRequest("cookie-admin", ACCOUNT_B)),
      await app.inject({
        method: "DELETE",
        url: `/admin/hcis-roles/assignments/${ASSIGNMENT_ID}`,
        headers: { cookie: "sq_hub_session=cookie-admin", origin: hubOrigin },
        payload: { requestId: "77777777-7777-4777-8777-777777777777" },
      }),
    ];
    expect(logLines.length).toBeGreaterThan(0);
    for (const text of [...responses.map((response) => response.body), ...logLines, JSON.stringify(audit)]) {
      expect(text).not.toContain("actor-assertion-secret");
      expect(text).not.toContain("machine-token-secret");
      expect(text).not.toContain("user-access-token");
    }
    await app.close();
  });

  it("reads the catalog from HCIS as it comes, with its own assertion (H-1, AC 2)", async () => {
    const { app, keycloak, hcis } = harness();
    const response = await app.inject({ method: "GET", url: "/admin/hcis-roles/catalog", headers: { cookie: "sq_hub_session=cookie-admin" } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(catalogBody);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(keycloak.filter((call) => call.grantType.endsWith("token-exchange"))).toHaveLength(1);
    expect(hcis[0]!.method).toBe("GET");
    await app.close();
  });

  it("revokes with requestId in the DELETE body and answers 204 (H-2b, AC 1c)", async () => {
    const { app, hcis, audit } = harness();
    const response = await app.inject({
      method: "DELETE",
      url: `/admin/hcis-roles/assignments/${ASSIGNMENT_ID}`,
      headers: { cookie: "sq_hub_session=cookie-admin", origin: hubOrigin },
      payload: { requestId: REQUEST_ID },
    });
    expect(response.statusCode).toBe(204);
    expect(hcis[0]).toMatchObject({
      method: "DELETE",
      url: `${hcisUrl}/internal/v1/role-administration/role-assignments/${ASSIGNMENT_ID}`,
      body: { requestId: REQUEST_ID },
    });
    expect(audit[0]).toMatchObject({ action: "hcis_role.assignment.remove", outcome: "succeeded" });
    await app.close();
  });

  it("exchanges a new assertion instead of reusing a spent one, keeping the requestId (AC 4)", async () => {
    let posts = 0;
    const { app, hcis } = harness({
      hcis: (request) => {
        posts += 1;
        return posts === 1
          ? json({ code: "ROLE_ADMIN_ACTOR_ASSERTION_SPENT" }, 409)
          : json({ assignmentId: ASSIGNMENT_ID, requestId: (request.body as { requestId: string }).requestId }, 201);
      },
    });
    const response = await app.inject(grantRequest("cookie-admin", ACCOUNT_B));
    expect(response.statusCode).toBe(201);
    expect(hcis.map((call) => call.headers.get("x-sq-actor-assertion"))).toEqual(["actor-assertion-secret-1", "actor-assertion-secret-2"]);
    expect(hcis.map((call) => (call.body as { requestId: string }).requestId)).toEqual([REQUEST_ID, REQUEST_ID]);
    await app.close();
  });

  it("retries a spent assertion only once", async () => {
    const { app, hcis } = harness({ hcis: () => json({ code: "ROLE_ADMIN_ACTOR_ASSERTION_SPENT" }, 409) });
    const response = await app.inject(grantRequest("cookie-admin", ACCOUNT_B));
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "ROLE_ADMIN_ACTOR_ASSERTION_SPENT" });
    expect(hcis).toHaveLength(2);
    await app.close();
  });

  it("reports a replayed requestId as a conflict, not a second assignment (AC 5)", async () => {
    const { app } = harness({ hcis: () => json({ code: "ROLE_ADMIN_REQUEST_REPLAYED" }, 409) });
    const response = await app.inject(grantRequest("cookie-admin", ACCOUNT_B));
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "ROLE_ADMIN_REQUEST_REPLAYED" });
    await app.close();
  });

  it("forwards HCIS's reason for refusing a self-grant (AC 3)", async () => {
    const { app, audit } = harness({
      hcis: () => json({ code: "ROLE_DELEGATION_FORBIDDEN", message: "Tidak dapat memberi peran kepada diri sendiri." }, 403),
    });
    const response = await app.inject(grantRequest("cookie-admin", ACCOUNT_A));
    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({ error: "ROLE_DELEGATION_FORBIDDEN", message: "Tidak dapat memberi peran kepada diri sendiri." });
    expect(audit[0]).toMatchObject({ outcome: "failed", payload: expect.objectContaining({ hcisCode: "ROLE_DELEGATION_FORBIDDEN" }) });
    await app.close();
  });

  it("shows the switched-off channel as its own state (AC 6)", async () => {
    const { app } = harness({ hcis: () => json({ code: "ROLE_ADMIN_CHANNEL_DISABLED" }, 503) });
    const response = await app.inject({ method: "GET", url: "/admin/hcis-roles/catalog", headers: { cookie: "sq_hub_session=cookie-admin" } });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "ROLE_ADMIN_CHANNEL_DISABLED" });
    await app.close();
  });

  it("fails closed when the exchange is refused, without calling HCIS", async () => {
    const { app, hcis } = harness({ exchangeStatus: 400 });
    const response = await app.inject(grantRequest("cookie-admin", ACCOUNT_B));
    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ error: "ROLE_ADMIN_ACTOR_EXCHANGE_FAILED" });
    expect(hcis).toEqual([]);
    await app.close();
  });

  it("hides unexpected HCIS answers behind one channel error", async () => {
    const { app } = harness({ hcis: () => json({ code: "FORBIDDEN_CLIENT", detail: "internal" }, 403) });
    const response = await app.inject(grantRequest("cookie-admin", ACCOUNT_B));
    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ error: "ROLE_ADMIN_CHANNEL_ERROR" });
    await app.close();
  });

  it("requires the Hub origin for changes and a well-formed body", async () => {
    const { app, keycloak } = harness();
    const foreign = await app.inject({ ...grantRequest("cookie-admin", ACCOUNT_B), headers: { cookie: "sq_hub_session=cookie-admin", origin: "https://evil.example" } });
    const withActor = await app.inject({ ...grantRequest("cookie-admin", ACCOUNT_B), payload: { ...grantRequest("cookie-admin", ACCOUNT_B).payload, actor: "x" } });
    expect(foreign.statusCode).toBe(403);
    expect(withActor.statusCode).toBe(400);
    expect(keycloak).toEqual([]);
    await app.close();
  });
});
