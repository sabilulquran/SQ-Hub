import { Writable } from "node:stream";

import { describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { KeycloakTokenExchanger } from "../src/modules/governance/token-exchange.js";
import type { HubSessionRecord } from "../src/modules/hub-auth/repository.js";
import { HubAuthError, type HubAuthRuntime } from "../src/modules/hub-auth/service.js";
import type { IdentityDirectory } from "../src/modules/identity-directory/client.js";
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
const hcisUrl = "https://hcis.example.test/api";
const tokenEndpoint = `${issuer}/protocol/openid-connect/token`;
const channelPrefix = `${hcisUrl}/internal/v1/role-administration/`;

const ACCOUNT_A = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_B = "22222222-2222-4222-8222-222222222222";
const ROLE_ID = "33333333-3333-4333-8333-333333333333";
const ASSIGNMENT_ID = "44444444-4444-4444-8444-444444444444";
const LOCKED_ASSIGNMENT_ID = "66666666-6666-4666-8666-666666666666";
const REQUEST_ID = "55555555-5555-4555-8555-555555555555";

const accountBySubject: Record<string, string> = { "employee-a": ACCOUNT_A, "employee-b": ACCOUNT_B };

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

// Cookie value → session. Two ordinary employees (both with an HCIS account, which the Hub does
// not even get to ask about) and one Platform Administrator.
const sessions: Record<string, HubSessionRecord> = {
  "cookie-employee-a": sessionFor("employee-a"),
  "cookie-employee-b": sessionFor("employee-b"),
  "cookie-admin": sessionFor("platform-admin"),
};

const directory: IdentityDirectory = {
  issuer,
  search: async () => [],
  inspect: async (subject) => ["employee-a", "employee-b", "platform-admin"].includes(subject)
    ? {
        identity: { issuer, subject },
        username: subject,
        email: null,
        emailVerified: false,
        displayName: `Synthetic ${subject}`,
        enabled: true,
        security: { totpConfigured: true, recoveryCodesConfigured: true },
      }
    : null,
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

type HcisRequest = { method: string; url: URL; headers: Headers; body: unknown };
type Responder = (request: HcisRequest) => Response | undefined;

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

function lookupBody(accountId: string) {
  const item = (assignmentId: string, revocableViaHub: boolean) => ({
    assignmentId, roleId: ROLE_ID, roleKey: "role-from-hcis", roleName: "Peran dari HCIS", scopeType: "organization",
    organizationalUnitId: null, organizationalUnitName: null, startsOn: null, endsOn: null,
    createdAt: "2026-10-30T00:00:00Z", revocableViaHub,
  });
  return {
    account: { accountId, principalType: "EMPLOYEE", status: "active", employeeStatus: "active" },
    assignments: { page: 1, pageSize: 25, total: 2, items: [item(ASSIGNMENT_ID, true), item(LOCKED_ASSIGNMENT_ID, false)] },
  };
}

function defaultHcis(request: HcisRequest): Response {
  const path = request.url.pathname.replace(new URL(channelPrefix).pathname, "");
  if (request.method === "GET" && path === "catalog") return json(catalogBody);
  if (request.method === "GET" && path === "accounts") {
    const accountId = accountBySubject[request.url.searchParams.get("subject") ?? ""];
    return accountId ? json(lookupBody(accountId)) : json({ code: "ROLE_ADMIN_ACCOUNT_NOT_FOUND" }, 404);
  }
  if (request.method === "POST") return json({ assignmentId: ASSIGNMENT_ID, requestId: (request.body as { requestId: string }).requestId }, 201);
  return new Response(null, { status: 204 });
}

function harness(options: { admins?: string[]; hcis?: Responder; exchangeStatus?: number; configured?: boolean } = {}) {
  const keycloak: Array<{ grantType: string; body: Record<string, string> }> = [];
  const hcis: HcisRequest[] = [];
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
    if (url.startsWith(channelPrefix)) {
      const request = {
        method: init.method ?? "GET",
        url: new URL(url),
        headers: new Headers(init.headers),
        body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
      };
      hcis.push(request);
      return options.hcis?.(request) ?? defaultHcis(request);
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
    identityDirectory: directory,
    roleAdministration: service,
    logStream: new Writable({ write(chunk, _encoding, callback) { logLines.push(String(chunk)); callback(); } }),
  });

  return { app, service, keycloak, hcis, userTokens, audit, log, logLines };
}

function grantRequest(cookie: string, subject: string, requestId = REQUEST_ID) {
  return {
    method: "POST" as const,
    url: `/admin/hcis-roles/staff/${subject}/assignments`,
    headers: { cookie: `sq_hub_session=${cookie}`, origin: hubOrigin },
    payload: { requestId, roleId: ROLE_ID, scopeType: "organization", reason: "Mandat SK 12/2026" },
  };
}

function revokeRequest(cookie: string, subject: string, assignmentId = ASSIGNMENT_ID, requestId = REQUEST_ID) {
  return {
    method: "DELETE" as const,
    url: `/admin/hcis-roles/staff/${subject}/assignments/${assignmentId}`,
    headers: { cookie: `sq_hub_session=${cookie}`, origin: hubOrigin },
    payload: { requestId },
  };
}

const exchanges = (calls: Array<{ grantType: string }>) => calls.filter((call) => call.grantType.endsWith("token-exchange"));

describe("H-0: only a Platform Administrator reaches the HCIS channel, and is checked before any exchange", () => {
  it("refuses two ordinary employees granting each other a role without one exchange request (AC 1b)", async () => {
    const { app, keycloak, hcis, userTokens, log } = harness();

    const aToB = await app.inject(grantRequest("cookie-employee-a", "employee-b"));
    const bToA = await app.inject(grantRequest("cookie-employee-b", "employee-a", "66666666-6666-4666-8666-666666666666"));

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

  it("refuses the catalog, the lookup and a revocation for an employee the same way", async () => {
    const { app, keycloak, hcis } = harness();
    const responses = [
      await app.inject({ method: "GET", url: "/admin/hcis-roles/catalog", headers: { cookie: "sq_hub_session=cookie-employee-a" } }),
      await app.inject({ method: "GET", url: "/admin/hcis-roles/staff/employee-b", headers: { cookie: "sq_hub_session=cookie-employee-a" } }),
      await app.inject(revokeRequest("cookie-employee-a", "employee-b")),
    ];
    expect(responses.map((response) => response.statusCode)).toEqual([403, 403, 403]);
    expect(keycloak).toEqual([]);
    expect(hcis).toEqual([]);
    await app.close();
  });

  it("refuses before validating the input, so a non-admin learns nothing from its shape", async () => {
    const { app, keycloak } = harness();
    const response = await app.inject({ ...grantRequest("cookie-employee-a", "nobody-in-directory"), payload: { anything: true } });
    expect(response.statusCode).toBe(403);
    expect(keycloak).toEqual([]);
    await app.close();
  });

  it("guards the service itself, not only the routes", async () => {
    const { service, keycloak, hcis } = harness();
    const employeeB = { issuer, subject: "employee-b" };
    await expect(service.grant(sessions["cookie-employee-a"]!, "cookie-employee-a", employeeB, {
      requestId: REQUEST_ID, roleId: ROLE_ID, scopeType: "organization",
      organizationalUnitId: null, reason: null, startsOn: null, endsOn: null,
    })).rejects.toMatchObject({ code: "ADMIN_FORBIDDEN" });
    await expect(service.catalog(sessions["cookie-employee-b"]!, "cookie-employee-b")).rejects.toMatchObject({ code: "ADMIN_FORBIDDEN" });
    await expect(service.lookup(sessions["cookie-employee-a"]!, "cookie-employee-a", employeeB)).rejects.toMatchObject({ code: "ADMIN_FORBIDDEN" });
    await expect(service.revoke(sessions["cookie-employee-b"]!, "cookie-employee-b", employeeB, { assignmentId: ASSIGNMENT_ID, requestId: REQUEST_ID }))
      .rejects.toMatchObject({ code: "ADMIN_FORBIDDEN" });
    expect(keycloak).toEqual([]);
    expect(hcis).toEqual([]);
  });

  it("refuses an employee even while the channel is not configured", async () => {
    const { app } = harness({ configured: false });
    const employee = await app.inject(grantRequest("cookie-employee-a", "employee-b"));
    const admin = await app.inject(grantRequest("cookie-admin", "employee-b"));
    expect(employee.json()).toEqual({ error: "ADMIN_FORBIDDEN" });
    expect(admin.statusCode).toBe(503);
    expect(admin.json()).toEqual({ error: "ROLE_ADMIN_CHANNEL_NOT_CONFIGURED" });
    await app.close();
  });

  it("refuses a revoked Platform Administrator", async () => {
    const { app, keycloak } = harness({ admins: [] });
    const response = await app.inject(grantRequest("cookie-admin", "employee-b"));
    expect(response.statusCode).toBe(403);
    expect(keycloak).toEqual([]);
    await app.close();
  });
});

describe("H-1/H-1b/H-2: the Platform Administrator's command to HCIS", () => {
  it("resolves the account from the picked person, then grants with two proofs and a fresh assertion per call", async () => {
    const { app, keycloak, hcis, audit } = harness();
    const response = await app.inject(grantRequest("cookie-admin", "employee-b"));
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ assignmentId: ASSIGNMENT_ID, requestId: REQUEST_ID });

    expect(keycloak.map((call) => call.grantType)).toEqual([
      "client_credentials",
      "urn:ietf:params:oauth:grant-type:token-exchange",
      "urn:ietf:params:oauth:grant-type:token-exchange",
    ]);
    expect(keycloak[0]!.body).toMatchObject({ client_id: "sq-hub-role-administration", scope: "role-administration.manage" });
    expect(keycloak[1]!.body).toMatchObject({
      client_id: "sq-hub",
      subject_token: "user-access-token-platform-admin",
      audience: "hcis-role-administration-actor",
      scope: "role-administration.actor",
    });

    expect(hcis).toHaveLength(2);
    const [lookup, grant] = hcis as [HcisRequest, HcisRequest];
    expect(lookup.method).toBe("GET");
    expect(Object.fromEntries(lookup.url.searchParams)).toEqual({ issuer, subject: "employee-b", page: "1", pageSize: "1" });
    expect(grant.method).toBe("POST");
    // The account id comes from HCIS's own answer for employee-b, never from the browser.
    expect(grant.url.href).toBe(`${channelPrefix}accounts/${ACCOUNT_B}/role-assignments`);
    expect(grant.headers.get("authorization")).toBe("Bearer machine-token-secret");
    expect(grant.headers.get("x-sq-actor-assertion")).toBe("actor-assertion-secret-2");
    // Identity never travels in the body (H-2).
    expect(grant.body).toEqual({
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

  it("does not accept an HCIS account id from the browser at all", async () => {
    const { app } = harness();
    const response = await app.inject({ ...grantRequest("cookie-admin", "employee-b"), payload: { ...grantRequest("cookie-admin", "employee-b").payload, accountId: ACCOUNT_A } });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("shows a person's HCIS account and assignments without identity data from HCIS (H-1b)", async () => {
    const { app, hcis } = harness();
    const response = await app.inject({ method: "GET", url: "/admin/hcis-roles/staff/employee-b?page=2", headers: { cookie: "sq_hub_session=cookie-admin" } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      staff: { subject: "employee-b", displayName: "Synthetic employee-b" },
      account: { accountId: ACCOUNT_B, status: "active" },
      assignments: { total: 2 },
    });
    expect(hcis[0]!.url.searchParams.get("page")).toBe("2");
    await app.close();
  });

  it("says when the person has no HCIS account, distinct from being refused", async () => {
    const { app } = harness();
    const response = await app.inject(grantRequest("cookie-admin", "platform-admin"));
    // Self is refused first; a person without an account is covered by the lookup.
    expect(response.json()).toEqual({ error: "ROLE_ADMIN_SELF_FORBIDDEN" });
    const lookup = await app.inject({ method: "GET", url: "/admin/hcis-roles/staff/platform-admin", headers: { cookie: "sq_hub_session=cookie-admin" } });
    expect(lookup.statusCode).toBe(404);
    expect(lookup.json()).toEqual({ error: "ROLE_ADMIN_ACCOUNT_NOT_FOUND" });
    await app.close();
  });

  it("refuses granting to or revoking from oneself before any exchange (AC 3)", async () => {
    const { app, keycloak } = harness();
    const grant = await app.inject(grantRequest("cookie-admin", "platform-admin"));
    const revoke = await app.inject(revokeRequest("cookie-admin", "platform-admin"));
    expect([grant.statusCode, revoke.statusCode]).toEqual([422, 422]);
    expect(revoke.json()).toEqual({ error: "ROLE_ADMIN_SELF_FORBIDDEN" });
    expect(keycloak).toEqual([]);
    await app.close();
  });

  it("forwards HCIS's own reason for a delegation refusal", async () => {
    const { app, audit } = harness({
      hcis: (request) => request.method === "POST"
        ? json({ code: "ROLE_DELEGATION_FORBIDDEN", message: "Peran ini tidak dapat didelegasikan." }, 403)
        : undefined,
    });
    const response = await app.inject(grantRequest("cookie-admin", "employee-a"));
    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({ error: "ROLE_DELEGATION_FORBIDDEN", message: "Peran ini tidak dapat didelegasikan." });
    expect(audit[0]).toMatchObject({ outcome: "failed", payload: expect.objectContaining({ hcisCode: "ROLE_DELEGATION_FORBIDDEN" }) });
    await app.close();
  });

  it("never lets the actor assertion or machine token reach the browser, the log or the audit (AC 7)", async () => {
    const { app, audit, logLines } = harness();
    const responses = [
      await app.inject({ method: "GET", url: "/admin/hcis-roles/catalog", headers: { cookie: "sq_hub_session=cookie-admin" } }),
      await app.inject({ method: "GET", url: "/admin/hcis-roles/staff/employee-b", headers: { cookie: "sq_hub_session=cookie-admin" } }),
      await app.inject(grantRequest("cookie-admin", "employee-b")),
      await app.inject(revokeRequest("cookie-admin", "employee-b", ASSIGNMENT_ID, "77777777-7777-4777-8777-777777777777")),
    ];
    expect(logLines.length).toBeGreaterThan(0);
    for (const text of [...responses.map((response) => response.body), ...logLines, JSON.stringify(audit)]) {
      expect(text).not.toContain("actor-assertion-secret");
      expect(text).not.toContain("machine-token-secret");
      expect(text).not.toContain("user-access-token");
    }
    await app.close();
  });

  it("reads the catalog from HCIS as it comes (H-1, AC 2)", async () => {
    const { app, keycloak, hcis } = harness();
    const response = await app.inject({ method: "GET", url: "/admin/hcis-roles/catalog", headers: { cookie: "sq_hub_session=cookie-admin" } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(catalogBody);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(exchanges(keycloak)).toHaveLength(1);
    expect(hcis[0]!.method).toBe("GET");
    await app.close();
  });

  it("revokes only an assignment of the picked person, with requestId in the DELETE body (H-2b, AC 1c)", async () => {
    const { app, hcis, audit } = harness();
    const response = await app.inject(revokeRequest("cookie-admin", "employee-b"));
    expect(response.statusCode).toBe(204);
    const deletion = hcis.find((request) => request.method === "DELETE")!;
    expect(deletion.url.href).toBe(`${channelPrefix}role-assignments/${ASSIGNMENT_ID}`);
    expect(deletion.body).toEqual({ requestId: REQUEST_ID });
    expect(audit[0]).toMatchObject({ action: "hcis_role.assignment.remove", outcome: "succeeded" });
    await app.close();
  });

  it("refuses an assignment that is not the person's, or that HCIS marks not revocable via the Hub", async () => {
    const { app, hcis } = harness();
    const foreign = await app.inject(revokeRequest("cookie-admin", "employee-b", "88888888-8888-4888-8888-888888888888"));
    const locked = await app.inject(revokeRequest("cookie-admin", "employee-b", LOCKED_ASSIGNMENT_ID));
    expect(foreign.json()).toEqual({ error: "ROLE_ADMIN_ASSIGNMENT_NOT_FOUND" });
    expect(locked.json()).toEqual({ error: "ROLE_ADMIN_ASSIGNMENT_NOT_REVOCABLE" });
    expect(hcis.filter((request) => request.method === "DELETE")).toEqual([]);
    await app.close();
  });

  it("exchanges a new assertion instead of reusing a spent one, keeping the requestId (AC 4)", async () => {
    let posts = 0;
    const { app, hcis } = harness({
      hcis: (request) => {
        if (request.method !== "POST") return undefined;
        posts += 1;
        return posts === 1
          ? json({ code: "ROLE_ADMIN_ACTOR_ASSERTION_SPENT" }, 409)
          : json({ assignmentId: ASSIGNMENT_ID, requestId: (request.body as { requestId: string }).requestId }, 201);
      },
    });
    const response = await app.inject(grantRequest("cookie-admin", "employee-b"));
    expect(response.statusCode).toBe(201);
    const postsSent = hcis.filter((request) => request.method === "POST");
    expect(postsSent.map((call) => call.headers.get("x-sq-actor-assertion"))).toEqual(["actor-assertion-secret-2", "actor-assertion-secret-3"]);
    expect(postsSent.map((call) => (call.body as { requestId: string }).requestId)).toEqual([REQUEST_ID, REQUEST_ID]);
    await app.close();
  });

  it("retries a spent assertion only once", async () => {
    const { app, hcis } = harness({ hcis: (request) => request.method === "POST" ? json({ code: "ROLE_ADMIN_ACTOR_ASSERTION_SPENT" }, 409) : undefined });
    const response = await app.inject(grantRequest("cookie-admin", "employee-b"));
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "ROLE_ADMIN_ACTOR_ASSERTION_SPENT" });
    expect(hcis.filter((request) => request.method === "POST")).toHaveLength(2);
    await app.close();
  });

  it("reports a replayed requestId as a conflict, not a second assignment (AC 5)", async () => {
    const { app } = harness({ hcis: (request) => request.method === "POST" ? json({ code: "ROLE_ADMIN_REQUEST_REPLAYED" }, 409) : undefined });
    const response = await app.inject(grantRequest("cookie-admin", "employee-b"));
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "ROLE_ADMIN_REQUEST_REPLAYED" });
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
    const response = await app.inject(grantRequest("cookie-admin", "employee-b"));
    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ error: "ROLE_ADMIN_ACTOR_EXCHANGE_FAILED" });
    expect(hcis).toEqual([]);
    await app.close();
  });

  it("passes HCIS's own domain refusals on by code with HCIS's message", async () => {
    const { app, audit } = harness({
      hcis: (request) => request.method === "POST"
        ? json({ code: "ADMIN_ORGANIZATION_MANDATE_REQUIRED", message: "Mandat wajib diisi untuk peran ini." }, 400)
        : undefined,
    });
    const response = await app.inject(grantRequest("cookie-admin", "employee-b"));
    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({ error: "ADMIN_ORGANIZATION_MANDATE_REQUIRED", message: "Mandat wajib diisi untuk peran ini." });
    expect(audit[0]).toMatchObject({ outcome: "failed", payload: expect.objectContaining({ hcisCode: "ADMIN_ORGANIZATION_MANDATE_REQUIRED" }) });
    await app.close();
  });

  it("reports a change whose answer never came back as outcome unknown, not as nothing happened", async () => {
    const { app, audit, log } = harness({
      hcis: (request) => { if (request.method === "POST") throw new Error("socket hang up"); return undefined; },
    });
    const response = await app.inject(grantRequest("cookie-admin", "employee-b"));
    expect(response.statusCode).toBe(504);
    expect(response.json()).toEqual({ error: "ROLE_ADMIN_OUTCOME_UNKNOWN" });
    expect(audit[0]).toMatchObject({ outcome: "failed", payload: expect.objectContaining({ hcisCode: "ROLE_ADMIN_OUTCOME_UNKNOWN" }) });
    expect(log).toContainEqual({ event: "role_administration.channel", operation: "grant", status: "outcome_unknown" });
    await app.close();
  });

  it("logs HCIS's error code so a rollout can tell which check refused", async () => {
    const { app, log } = harness({ hcis: () => json({ code: "FORBIDDEN_CLIENT" }, 403) });
    await app.inject({ method: "GET", url: "/admin/hcis-roles/catalog", headers: { cookie: "sq_hub_session=cookie-admin" } });
    expect(log).toContainEqual({ event: "role_administration.channel", operation: "catalog", status: 403, hcisCode: "FORBIDDEN_CLIENT" });
    await app.close();
  });

  it("hides unexpected HCIS answers behind one channel error", async () => {
    const { app } = harness({ hcis: () => json({ code: "FORBIDDEN_CLIENT", detail: "internal" }, 403) });
    const response = await app.inject(grantRequest("cookie-admin", "employee-b"));
    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ error: "ROLE_ADMIN_CHANNEL_ERROR" });
    await app.close();
  });

  it("requires the Hub origin for changes, a well-formed body and a person in the directory", async () => {
    const { app, keycloak } = harness();
    const foreign = await app.inject({ ...grantRequest("cookie-admin", "employee-b"), headers: { cookie: "sq_hub_session=cookie-admin", origin: "https://evil.example" } });
    const withActor = await app.inject({ ...grantRequest("cookie-admin", "employee-b"), payload: { ...grantRequest("cookie-admin", "employee-b").payload, actor: "x" } });
    const unknown = await app.inject(grantRequest("cookie-admin", "nobody-in-directory"));
    expect(foreign.statusCode).toBe(403);
    expect(withActor.statusCode).toBe(400);
    expect(unknown.json()).toEqual({ error: "STAFF_NOT_FOUND" });
    expect(keycloak).toEqual([]);
    await app.close();
  });
});
