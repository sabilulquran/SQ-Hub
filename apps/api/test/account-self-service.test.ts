import { afterEach, describe, expect, it, vi } from "vitest";

import {
  KeycloakAccountSelfService,
} from "../src/modules/account-self-service/client.js";

const issuer = "https://login.example.test/realms/staff";
const token = "short-lived-access-token";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function installFetch(
  responses: Record<string, unknown | { status: number; body?: unknown }>,
) {
  const calls: Array<{ url: string; authorization: string | null; method: string }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url =
        input instanceof Request
          ? input.url
          : input instanceof URL
            ? input.href
            : input;
      const method = init?.method ?? "GET";
      const headers = new Headers(init?.headers);
      calls.push({
        url,
        authorization: headers.get("Authorization"),
        method,
      });
      const parsed = new URL(url);
      const key = parsed.pathname + parsed.search;
      const value = responses[key];
      if (value === undefined) {
        throw new Error(`unexpected fetch: ${method} ${key}`);
      }
      if (
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        "status" in value
      ) {
        const response = value as { status: number; body?: unknown };
        return response.body === undefined
          ? new Response(null, { status: response.status })
          : jsonResponse(response.body, response.status);
      }
      return jsonResponse(value);
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("KeycloakAccountSelfService", () => {
  it("maps official account resources into a browser-safe parity snapshot", async () => {
    const calls = installFetch({
      "/realms/staff/account/?userProfileMetadata=true": {
        username: "19870001",
        firstName: "Ahmad",
        lastName: "Fikri",
        email: "ahmad@example.test",
        emailVerified: true,
        attributes: { locale: ["id"] },
        userProfileMetadata: {
          attributes: [
            {
              name: "locale",
              displayName: "locale",
              required: false,
              readOnly: false,
              multivalued: false,
            },
            {
              name: "username",
              displayName: "username",
              required: true,
              readOnly: true,
              multivalued: false,
            },
            {
              name: "firstName",
              displayName: "firstName",
              required: true,
              readOnly: false,
              multivalued: false,
            },
            {
              name: "email",
              displayName: "email",
              required: true,
              readOnly: false,
              multivalued: false,
              annotations: { "kc.required.action.supported": true },
            },
          ],
        },
      },
      "/realms/staff/account/credentials": [
        {
          type: "otp",
          category: "two-factor",
          displayName: "otp-display-name",
          helptext: "Authenticator",
          createAction: "CONFIGURE_TOTP",
          updateAction: "",
          removeable: true,
          userCredentialMetadatas: [
            {
              credential: {
                id: "cred-otp-1",
                userLabel: "Ponsel utama",
                createdDate: 1790000000000,
              },
            },
          ],
        },
        {
          type: "webauthn-passwordless",
          category: "passwordless",
          displayName: "webauthn-passwordless-display-name",
          helptext: "Passkey",
          createAction: "webauthn-register-passwordless",
          updateAction: "",
          removeable: false,
          userCredentialMetadatas: [],
        },
      ],
      "/realms/staff/account/sessions/devices": [
        {
          id: "device-1",
          device: "Desktop",
          os: "Windows",
          osVersion: "11",
          browser: "Edge",
          ipAddress: "192.0.2.1",
          lastAccess: 1790000000000,
          current: true,
          mobile: false,
          sessions: [
            {
              id: "session-1",
              ipAddress: "192.0.2.1",
              browser: "Edge",
              started: 1789990000000,
              lastAccess: 1790000000000,
              expires: 1790040000000,
              current: true,
              clients: [{ clientId: "sq-hub", clientName: "SQ Hub" }],
            },
          ],
        },
      ],
      "/realms/staff/account/applications": [
        {
          clientId: "sq-hub",
          clientName: "SQ Hub",
          description: "Hub",
          effectiveUrl: "https://hub.example.test",
          inUse: true,
          userConsentRequired: false,
          offlineAccess: false,
        },
        {
          clientId: "unsafe-preview",
          clientName: "Unsafe preview",
          description: "Synthetic unsafe URL test",
          effectiveUrl: "javascript:alert(1)",
          inUse: false,
          userConsentRequired: false,
          offlineAccess: false,
        },
      ],
      "/realms/staff/account/linked-accounts?linked=true&first=0&max=100": [
        {
          connected: true,
          providerAlias: "google",
          providerName: "google",
          displayName: "Google",
          linkedUsername: "ahmad@example.test",
          social: true,
        },
      ],
      "/realms/staff/account/linked-accounts?linked=false&first=0&max=100": [],
      "/realms/staff/account/groups": [
        { id: "group-1", name: "Human Capital", path: "/Human Capital" },
      ],
      "/realms/staff/account/supportedLocales": ["id"],
    });
    const client = new KeycloakAccountSelfService(issuer);

    const snapshot = await client.snapshot(token);

    expect(snapshot.profile).toMatchObject({
      displayName: "Ahmad Fikri",
      username: "19870001",
      email: "ahmad@example.test",
      emailVerified: true,
    });
    expect(snapshot.profile.fields).toEqual([
      {
        name: "locale",
        label: "locale",
        required: false,
        readOnly: false,
        multivalued: false,
        values: ["id"],
        requiredAction: null,
      },
      {
        name: "username",
        label: "username",
        required: true,
        readOnly: true,
        multivalued: false,
        values: ["19870001"],
        requiredAction: null,
      },
      {
        name: "firstName",
        label: "firstName",
        required: true,
        readOnly: false,
        multivalued: false,
        values: ["Ahmad"],
        requiredAction: null,
      },
      {
        name: "email",
        label: "email",
        required: true,
        readOnly: false,
        multivalued: false,
        values: ["ahmad@example.test"],
        requiredAction: "UPDATE_EMAIL",
      },
    ]);
    expect(snapshot.profile.supportedLocales).toEqual(["id"]);
    expect(snapshot.credentials[0]?.credentials[0]?.id).toBe("cred-otp-1");
    expect(snapshot.credentials[1]).toMatchObject({
      type: "webauthn-passwordless",
      canCreate: true,
      canUpdate: false,
    });
    expect(JSON.stringify(snapshot.credentials)).not.toContain(
      "webauthn-register-passwordless",
    );
    expect(JSON.stringify(snapshot.credentials)).not.toContain("CONFIGURE_TOTP");
    expect(snapshot.devices[0]?.sessions[0]?.current).toBe(true);
    expect(snapshot.applications[0]?.name).toBe("SQ Hub");
    expect(snapshot.applications[0]?.effectiveUrl).toBe("https://hub.example.test/");
    expect(snapshot.applications[1]?.effectiveUrl).toBeNull();
    expect(snapshot.linkedAccounts[0]?.providerAlias).toBe("google");
    expect(snapshot.groups[0]).toEqual({
      name: "Human Capital",
      path: "/Human Capital",
    });
    expect(calls.every((call) => call.authorization === `Bearer ${token}`)).toBe(true);
    expect(JSON.stringify(snapshot)).not.toContain(token);
  });

  it("keeps unknown credential types visible without exposing unsafe provider actions", async () => {
    installFetch({
      "/realms/staff/account/?userProfileMetadata=true": {
        username: "19870001",
        attributes: {},
        userProfileMetadata: { attributes: [] },
      },
      "/realms/staff/account/credentials": [
        {
          type: "future-factor",
          category: "future",
          displayName: "Future factor",
          helptext: "A future provider credential",
          createAction: "delete_account",
          updateAction: "future factor with spaces",
          removeable: false,
          userCredentialMetadatas: [],
        },
      ],
      "/realms/staff/account/sessions/devices": [],
      "/realms/staff/account/applications": [],
      "/realms/staff/account/linked-accounts?linked=true&first=0&max=100": [],
      "/realms/staff/account/linked-accounts?linked=false&first=0&max=100": [],
      "/realms/staff/account/groups": [],
      "/realms/staff/account/supportedLocales": ["id"],
    });
    const client = new KeycloakAccountSelfService(issuer);

    const snapshot = await client.snapshot(token);

    expect(snapshot.credentials).toHaveLength(1);
    expect(snapshot.credentials[0]).toMatchObject({
      type: "future-factor",
      canCreate: false,
      canUpdate: false,
    });
    expect(JSON.stringify(snapshot.credentials)).not.toContain("delete_account");
    expect(JSON.stringify(snapshot.credentials)).not.toContain("future factor with spaces");

    await expect(
      client.resolveCredentialAction(token, {
        type: "future-factor",
        operation: "create",
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "CREDENTIAL_ACTION_NOT_AVAILABLE",
    });
  });

  it("keeps the required Account API snapshot usable when optional groups are forbidden", async () => {
    installFetch({
      "/realms/staff/account/?userProfileMetadata=true": {
        username: "19870001",
        attributes: {},
        userProfileMetadata: { attributes: [] },
      },
      "/realms/staff/account/credentials": [],
      "/realms/staff/account/sessions/devices": [],
      "/realms/staff/account/applications": [],
      "/realms/staff/account/linked-accounts?linked=true&first=0&max=100": [],
      "/realms/staff/account/linked-accounts?linked=false&first=0&max=100": [],
      "/realms/staff/account/groups": { status: 403 },
      "/realms/staff/account/supportedLocales": ["id"],
    });
    const client = new KeycloakAccountSelfService(issuer);

    const snapshot = await client.snapshot(token);

    expect(snapshot.profile.username).toBe("19870001");
    expect(snapshot.profile.supportedLocales).toEqual(["id"]);
    expect(snapshot.groups).toEqual([]);
  });

  it("refuses profile fields that Account API marks read-only", async () => {
    installFetch({
      "/realms/staff/account/?userProfileMetadata=true": {
        username: "19870001",
        attributes: {},
        userProfileMetadata: {
          attributes: [
            {
              name: "username",
              displayName: "username",
              readOnly: true,
              required: true,
              multivalued: false,
            },
          ],
        },
      },
    });
    const client = new KeycloakAccountSelfService(issuer);

    await expect(
      client.updateProfile(token, { username: ["forged"] }),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "PROFILE_FIELD_NOT_EDITABLE",
    });
  });

  it("routes provider-managed email changes through UPDATE_EMAIL instead of direct profile mutation", async () => {
    installFetch({
      "/realms/staff/account/?userProfileMetadata=true": {
        email: "ahmad@example.test",
        attributes: {},
        userProfileMetadata: {
          attributes: [
            {
              name: "email",
              displayName: "email",
              readOnly: false,
              required: true,
              multivalued: false,
              annotations: { "kc.required.action.supported": true },
            },
          ],
        },
      },
    });
    const client = new KeycloakAccountSelfService(issuer);

    await expect(client.resolveProfileAction(token, "email")).resolves.toBe(
      "UPDATE_EMAIL",
    );
    await expect(
      client.updateProfile(token, { email: ["baru@example.test"] }),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "PROFILE_FIELD_REQUIRES_ACTION",
    });
    await expect(client.resolveProfileAction(token, "username")).rejects.toMatchObject({
      statusCode: 404,
      code: "PROFILE_ACTION_NOT_AVAILABLE",
    });
  });

  it("validates a session belongs to the current account before logout", async () => {
    const calls = installFetch({
      "/realms/staff/account/sessions/devices": [
        {
          sessions: [
            { id: "current-session", current: true },
            { id: "owned-session", current: false },
          ],
        },
      ],
      "/realms/staff/account/sessions/owned-session": { status: 204 },
    });
    const client = new KeycloakAccountSelfService(issuer);

    await expect(client.logoutSession(token, "foreign-session")).rejects.toMatchObject({
      statusCode: 404,
      code: "SESSION_NOT_FOUND",
    });
    await expect(client.logoutSession(token, "current-session")).rejects.toMatchObject({
      statusCode: 400,
      code: "CURRENT_SESSION_REQUIRES_ACCOUNT_LOGOUT",
    });
    await client.logoutSession(token, "owned-session");

    expect(calls.filter((call) => call.method === "DELETE")).toHaveLength(1);
    expect(calls.at(-1)?.url).toContain("/account/sessions/owned-session");
  });

  it("logs out other sessions through the provider bulk session endpoint", async () => {
    const calls = installFetch({
      "/realms/staff/account/sessions": { status: 204 },
    });
    const client = new KeycloakAccountSelfService(issuer);

    await client.logoutOtherSessions(token);

    expect(calls.at(-1)).toMatchObject({
      method: "DELETE",
      url: "https://login.example.test/realms/staff/account/sessions",
    });
  });

  it("unlinks a provider by the provider-owned name after validating the browser alias", async () => {
    const calls = installFetch({
      "/realms/staff/account/linked-accounts?linked=true&first=0&max=100": [
        {
          connected: true,
          providerAlias: "google",
          providerName: "google-oauth2",
          displayName: "Google",
          linkedUsername: "ahmad@example.test",
          social: true,
        },
      ],
      "/realms/staff/account/linked-accounts/google-oauth2": { status: 204 },
    });
    const client = new KeycloakAccountSelfService(issuer);

    await client.unlinkAccount(token, "google");

    expect(calls.at(-1)).toMatchObject({
      method: "DELETE",
      url: "https://login.example.test/realms/staff/account/linked-accounts/google-oauth2",
    });
    await expect(client.unlinkAccount(token, "unknown")).rejects.toMatchObject({
      statusCode: 404,
      code: "LINKED_ACCOUNT_NOT_FOUND",
    });
  });

  it("only exposes provider-reported link actions and supported credential actions", async () => {
    installFetch({
      "/realms/staff/account/linked-accounts?linked=false&first=0&max=100": [
        {
          connected: false,
          providerAlias: "google",
          providerName: "google",
          displayName: "Google",
          social: true,
        },
      ],
      "/realms/staff/account/credentials": [
        {
          type: "password",
          createAction: "",
          updateAction: "UPDATE_PASSWORD",
          userCredentialMetadatas: [],
        },
        {
          type: "webauthn-passwordless",
          createAction: "webauthn-register-passwordless",
          updateAction: "",
          userCredentialMetadatas: [],
        },
        {
          type: "unsafe-delete",
          createAction: "DELETE_ACCOUNT",
          updateAction: "",
          userCredentialMetadatas: [],
        },
        {
          type: "unsafe-email",
          createAction: "Update_Email",
          updateAction: "",
          userCredentialMetadatas: [],
        },
      ],
    });
    const client = new KeycloakAccountSelfService(issuer);

    await expect(client.resolveLinkAction(token, "unknown")).rejects.toMatchObject({
      code: "ACCOUNT_LINK_NOT_AVAILABLE",
    });
    await expect(client.resolveLinkAction(token, "google")).resolves.toBe(
      "idp_link:google",
    );
    await expect(
      client.resolveCredentialAction(token, {
        type: "password",
        operation: "update",
      }),
    ).resolves.toBe("UPDATE_PASSWORD");
    await expect(
      client.resolveCredentialAction(token, {
        type: "webauthn-passwordless",
        operation: "create",
      }),
    ).resolves.toBe("webauthn-register-passwordless");
    await expect(
      client.resolveCredentialAction(token, {
        type: "unsafe-delete",
        operation: "create",
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "CREDENTIAL_ACTION_NOT_AVAILABLE",
    });
    await expect(
      client.resolveCredentialAction(token, {
        type: "unsafe-email",
        operation: "create",
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "CREDENTIAL_ACTION_NOT_AVAILABLE",
    });
  });
});
