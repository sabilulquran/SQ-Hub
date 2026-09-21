export class AccountSelfServiceError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
  ) {
    super(code);
    this.name = "AccountSelfServiceError";
  }
}

export interface AccountProfileField {
  name: string;
  label: string;
  required: boolean;
  readOnly: boolean;
  multivalued: boolean;
  values: string[];
}

export interface AccountCredential {
  id: string;
  label: string | null;
  createdAt: number | null;
}

export interface AccountCredentialType {
  type: string;
  category: string;
  label: string;
  helpText: string;
  createAction: string | null;
  updateAction: string | null;
  removeable: boolean;
  credentials: AccountCredential[];
}

export interface AccountSession {
  id: string;
  ipAddress: string | null;
  browser: string | null;
  startedAt: number | null;
  lastAccessAt: number | null;
  expiresAt: number | null;
  current: boolean;
  clients: string[];
}

export interface AccountDevice {
  id: string;
  device: string | null;
  os: string | null;
  osVersion: string | null;
  browser: string | null;
  ipAddress: string | null;
  lastAccessAt: number | null;
  current: boolean;
  mobile: boolean;
  sessions: AccountSession[];
}

export interface IdentityApplication {
  clientId: string;
  name: string;
  description: string | null;
  effectiveUrl: string | null;
  inUse: boolean;
  userConsentRequired: boolean;
  offlineAccess: boolean;
  consent: null | {
    createdAt: number | null;
    lastUpdatedAt: number | null;
    scopes: Array<{ id: string; name: string; label: string }>;
  };
}

export interface LinkedAccount {
  connected: boolean;
  providerAlias: string;
  providerName: string;
  displayName: string;
  linkedUsername: string | null;
  social: boolean;
}

export interface AccountGroup {
  name: string;
  path: string;
  direct: boolean;
}

export interface AccountSelfServiceSnapshot {
  profile: {
    displayName: string;
    username: string | null;
    email: string | null;
    emailVerified: boolean | null;
    fields: AccountProfileField[];
  };
  credentials: AccountCredentialType[];
  devices: AccountDevice[];
  applications: IdentityApplication[];
  linkedAccounts: LinkedAccount[];
  availableAccountLinks: LinkedAccount[];
  groups: AccountGroup[];
}

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function boolValue(value: unknown): boolean {
  return value === true;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function valuesForAttribute(source: JsonRecord, name: string): string[] {
  const raw = record(source.attributes)[name] ?? source[name];
  if (Array.isArray(raw)) {
    return raw.filter((item): item is string => typeof item === "string");
  }
  const single = stringValue(raw);
  return single ? [single] : [];
}

export class KeycloakAccountSelfService {
  private readonly accountBaseUrl: URL;

  constructor(issuer: string) {
    this.accountBaseUrl = new URL(issuer.replace(/\/$/, "") + "/account/");
  }

  async snapshot(accessToken: string): Promise<AccountSelfServiceSnapshot> {
    const [profileRaw, credentialsRaw, devicesRaw, applicationsRaw, linkedRaw, availableRaw, groupsRaw] =
      await Promise.all([
        this.json(accessToken, "?userProfileMetadata=true"),
        this.json(accessToken, "credentials"),
        this.json(accessToken, "sessions/devices"),
        this.json(accessToken, "applications"),
        this.json(accessToken, "linked-accounts?linked=true&first=0&max=100"),
        this.json(accessToken, "linked-accounts?linked=false&first=0&max=100"),
        this.optionalJson(accessToken, "groups"),
      ]);

    const profileRecord = record(profileRaw);
    const metadata = record(profileRecord.userProfileMetadata);
    const fieldMetadata = Array.isArray(metadata.attributes) ? metadata.attributes : [];
    const fields = fieldMetadata.map((item) => {
      const field = record(item);
      const name = stringValue(field.name) ?? "";
      return {
        name,
        label: stringValue(field.displayName) ?? name,
        required: boolValue(field.required),
        readOnly: boolValue(field.readOnly),
        multivalued: boolValue(field.multivalued),
        values: valuesForAttribute(profileRecord, name),
      };
    }).filter((field) => field.name);

    const credentials = (Array.isArray(credentialsRaw) ? credentialsRaw : []).map((item) => {
      const container = record(item);
      const userCredentials = Array.isArray(container.userCredentialMetadatas)
        ? container.userCredentialMetadatas
        : [];
      return {
        type: stringValue(container.type) ?? "unknown",
        category: stringValue(container.category) ?? "other",
        label: stringValue(container.displayName) ?? stringValue(container.type) ?? "Credential",
        helpText: stringValue(container.helptext) ?? "",
        createAction: stringValue(container.createAction),
        updateAction: stringValue(container.updateAction),
        removeable: boolValue(container.removeable),
        credentials: userCredentials.map((entry) => {
          const credential = record(record(entry).credential);
          return {
            id: stringValue(credential.id) ?? "",
            label: stringValue(credential.userLabel),
            createdAt: numberValue(credential.createdDate),
          };
        }).filter((credential) => credential.id),
      };
    });

    const devices = (Array.isArray(devicesRaw) ? devicesRaw : []).map((item) => {
      const device = record(item);
      const sessions = Array.isArray(device.sessions) ? device.sessions : [];
      return {
        id: stringValue(device.id) ?? "",
        device: stringValue(device.device),
        os: stringValue(device.os),
        osVersion: stringValue(device.osVersion),
        browser: stringValue(device.browser),
        ipAddress: stringValue(device.ipAddress),
        lastAccessAt: numberValue(device.lastAccess),
        current: boolValue(device.current),
        mobile: boolValue(device.mobile),
        sessions: sessions.map((entry) => {
          const session = record(entry);
          const clients = Array.isArray(session.clients) ? session.clients : [];
          return {
            id: stringValue(session.id) ?? "",
            ipAddress: stringValue(session.ipAddress),
            browser: stringValue(session.browser),
            startedAt: numberValue(session.started),
            lastAccessAt: numberValue(session.lastAccess),
            expiresAt: numberValue(session.expires),
            current: boolValue(session.current),
            clients: clients.map((client) => {
              const c = record(client);
              return stringValue(c.clientName) ?? stringValue(c.clientId) ?? "";
            }).filter(Boolean),
          };
        }).filter((session) => session.id),
      };
    });

    const applications = (Array.isArray(applicationsRaw) ? applicationsRaw : []).map((item) => {
      const application = record(item);
      const consentRecord = application.consent ? record(application.consent) : null;
      const scopes = consentRecord && Array.isArray(consentRecord.grantedScopes)
        ? consentRecord.grantedScopes
        : [];
      const clientId = stringValue(application.clientId) ?? "";
      return {
        clientId,
        name: stringValue(application.clientName) ?? clientId,
        description: stringValue(application.description),
        effectiveUrl: stringValue(application.effectiveUrl),
        inUse: boolValue(application.inUse),
        userConsentRequired: boolValue(application.userConsentRequired),
        offlineAccess: boolValue(application.offlineAccess),
        consent: consentRecord
          ? {
              createdAt: numberValue(consentRecord.createdDate),
              lastUpdatedAt: numberValue(consentRecord.lastUpdatedDate),
              scopes: scopes.map((scope) => {
                const s = record(scope);
                const name = stringValue(s.name) ?? "";
                return {
                  id: stringValue(s.id) ?? name,
                  name,
                  label: stringValue(s.displayText) ?? name,
                };
              }).filter((scope) => scope.name),
            }
          : null,
      };
    }).filter((application) => application.clientId);

    const linkedAccounts = this.mapLinkedAccounts(linkedRaw);
    const availableAccountLinks = this.mapLinkedAccounts(availableRaw);
    const groups = (Array.isArray(groupsRaw) ? groupsRaw : []).map((item) => {
      const group = record(item);
      return {
        name: stringValue(group.name) ?? "",
        path: stringValue(group.path) ?? "",
        direct: Boolean(stringValue(group.id)),
      };
    }).filter((group) => group.name && group.path);

    const firstName = stringValue(profileRecord.firstName) ?? "";
    const lastName = stringValue(profileRecord.lastName) ?? "";

    return {
      profile: {
        displayName:
          [firstName, lastName].filter(Boolean).join(" ") ||
          stringValue(profileRecord.username) ||
          "Akun SQ",
        username: stringValue(profileRecord.username),
        email: stringValue(profileRecord.email),
        emailVerified:
          typeof profileRecord.emailVerified === "boolean"
            ? profileRecord.emailVerified
            : null,
        fields,
      },
      credentials,
      devices,
      applications,
      linkedAccounts,
      availableAccountLinks,
      groups,
    };
  }

  async updateProfile(
    accessToken: string,
    fields: Record<string, string[]>,
  ): Promise<void> {
    const current = record(await this.json(accessToken, "?userProfileMetadata=true"));
    const metadata = record(current.userProfileMetadata);
    const fieldMetadata = Array.isArray(metadata.attributes) ? metadata.attributes : [];
    const allowed = new Map(
      fieldMetadata.map((item) => {
        const field = record(item);
        return [
          stringValue(field.name) ?? "",
          {
            readOnly: boolValue(field.readOnly),
            multivalued: boolValue(field.multivalued),
          },
        ] as const;
      }).filter(([name]) => name),
    );

    for (const [name, values] of Object.entries(fields)) {
      const field = allowed.get(name);
      if (!field || field.readOnly) {
        throw new AccountSelfServiceError(400, "PROFILE_FIELD_NOT_EDITABLE");
      }
      if (!field.multivalued && values.length > 1) {
        throw new AccountSelfServiceError(400, "PROFILE_FIELD_INVALID");
      }
    }

    const attributes = {
      ...record(current.attributes),
      ...Object.fromEntries(
        Object.entries(fields).map(([name, values]) => [
          name,
          values.map((value) => value.trim()),
        ]),
      ),
    };

    const payload: JsonRecord = {
      ...current,
      attributes,
    };
    delete payload.userProfileMetadata;

    for (const name of ["username", "email", "firstName", "lastName"]) {
      if (fields[name]) {
        payload[name] = fields[name]?.[0] ?? "";
      }
    }

    await this.voidRequest(accessToken, "", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async revokeConsent(accessToken: string, clientId: string): Promise<void> {
    const applications = await this.json(accessToken, "applications");
    const exists = (Array.isArray(applications) ? applications : []).some(
      (item) => stringValue(record(item).clientId) === clientId,
    );
    if (!exists) throw new AccountSelfServiceError(404, "APPLICATION_NOT_FOUND");
    await this.voidRequest(
      accessToken,
      `applications/${encodeURIComponent(clientId)}/consent`,
      { method: "DELETE" },
    );
  }

  async logoutSession(accessToken: string, sessionId: string): Promise<void> {
    const devices = await this.json(accessToken, "sessions/devices");
    const exists = (Array.isArray(devices) ? devices : []).some((item) => {
      const sessions = Array.isArray(record(item).sessions) ? record(item).sessions as unknown[] : [];
      return sessions.some(
        (session) => stringValue(record(session).id) === sessionId,
      );
    });
    if (!exists) throw new AccountSelfServiceError(404, "SESSION_NOT_FOUND");
    await this.voidRequest(
      accessToken,
      `sessions/${encodeURIComponent(sessionId)}`,
      { method: "DELETE" },
    );
  }

  async logoutOtherSessions(accessToken: string): Promise<void> {
    await this.voidRequest(accessToken, "sessions", { method: "DELETE" });
  }

  async unlinkAccount(accessToken: string, providerAlias: string): Promise<void> {
    const linked = this.mapLinkedAccounts(
      await this.json(accessToken, "linked-accounts?linked=true&first=0&max=100"),
    );
    if (!linked.some((account) => account.providerAlias === providerAlias)) {
      throw new AccountSelfServiceError(404, "LINKED_ACCOUNT_NOT_FOUND");
    }
    await this.voidRequest(
      accessToken,
      `linked-accounts/${encodeURIComponent(providerAlias)}`,
      { method: "DELETE" },
    );
  }

  async resolveLinkAction(accessToken: string, providerAlias: string): Promise<`idp_link:${string}`> {
    const available = this.mapLinkedAccounts(
      await this.json(accessToken, "linked-accounts?linked=false&first=0&max=100"),
    );
    if (!available.some((account) => account.providerAlias === providerAlias)) {
      throw new AccountSelfServiceError(404, "ACCOUNT_LINK_NOT_AVAILABLE");
    }
    return `idp_link:${providerAlias}`;
  }

  async resolveCredentialAction(
    accessToken: string,
    input: { type: string; operation: "create" | "update" },
  ): Promise<string> {
    const credentials = await this.snapshotCredentials(accessToken);
    const container = credentials.find((item) => item.type === input.type);
    if (!container) throw new AccountSelfServiceError(404, "CREDENTIAL_TYPE_NOT_FOUND");
    const action = input.operation === "create"
      ? container.createAction
      : container.updateAction;
    if (!action) throw new AccountSelfServiceError(400, "CREDENTIAL_ACTION_NOT_AVAILABLE");
    if (!/^[A-Za-z0-9_.-]+$/.test(action)) {
      throw new AccountSelfServiceError(400, "CREDENTIAL_ACTION_INVALID");
    }
    return action;
  }

  async resolveDeleteCredentialAction(
    accessToken: string,
    credentialId: string,
  ): Promise<`delete_credential:${string}`> {
    const credentials = await this.snapshotCredentials(accessToken);
    const removable = credentials.some(
      (container) =>
        container.removeable &&
        container.credentials.some((credential) => credential.id === credentialId),
    );
    if (!removable || !/^[A-Za-z0-9_.:-]+$/.test(credentialId)) {
      throw new AccountSelfServiceError(404, "CREDENTIAL_NOT_REMOVABLE");
    }
    return `delete_credential:${credentialId}`;
  }

  async setCredentialLabel(
    accessToken: string,
    credentialId: string,
    label: string,
  ): Promise<void> {
    const credentials = await this.snapshotCredentials(accessToken);
    const exists = credentials.some((container) =>
      container.credentials.some((credential) => credential.id === credentialId),
    );
    if (!exists) throw new AccountSelfServiceError(404, "CREDENTIAL_NOT_FOUND");
    await this.voidRequest(
      accessToken,
      `credentials/${encodeURIComponent(credentialId)}/label`,
      { method: "PUT", body: JSON.stringify(label.trim()) },
    );
  }

  private async snapshotCredentials(accessToken: string): Promise<AccountCredentialType[]> {
    const raw = await this.json(accessToken, "credentials");
    const items = Array.isArray(raw) ? raw : [];
    return items.map((item) => {
      const container = record(item);
      const userCredentials = Array.isArray(container.userCredentialMetadatas)
        ? container.userCredentialMetadatas
        : [];
      return {
        type: stringValue(container.type) ?? "unknown",
        category: stringValue(container.category) ?? "other",
        label: stringValue(container.displayName) ?? stringValue(container.type) ?? "Credential",
        helpText: stringValue(container.helptext) ?? "",
        createAction: stringValue(container.createAction),
        updateAction: stringValue(container.updateAction),
        removeable: boolValue(container.removeable),
        credentials: userCredentials.map((entry) => {
          const credential = record(record(entry).credential);
          return {
            id: stringValue(credential.id) ?? "",
            label: stringValue(credential.userLabel),
            createdAt: numberValue(credential.createdDate),
          };
        }).filter((credential) => credential.id),
      };
    });
  }

  private mapLinkedAccounts(raw: unknown): LinkedAccount[] {
    return (Array.isArray(raw) ? raw : []).map((item) => {
      const account = record(item);
      const providerAlias =
        stringValue(account.providerAlias) ??
        stringValue(account.providerName) ??
        "";
      return {
        connected: boolValue(account.connected),
        providerAlias,
        providerName: stringValue(account.providerName) ?? providerAlias,
        displayName:
          stringValue(account.displayName) ??
          stringValue(account.providerName) ??
          providerAlias,
        linkedUsername: stringValue(account.linkedUsername),
        social: boolValue(account.social),
      };
    }).filter((account) => account.providerAlias);
  }

  private async optionalJson(accessToken: string, path: string): Promise<unknown> {
    try {
      return await this.json(accessToken, path);
    } catch (error) {
      if (
        error instanceof AccountSelfServiceError &&
        (error.statusCode === 403 || error.statusCode === 404)
      ) {
        return [];
      }
      throw error;
    }
  }

  private async json(accessToken: string, path: string): Promise<unknown> {
    const response = await this.request(accessToken, path);
    if (response.status === 204) return null;
    return response.json();
  }

  private async voidRequest(
    accessToken: string,
    path: string,
    init: RequestInit,
  ): Promise<void> {
    await this.request(accessToken, path, init);
  }

  private async request(
    accessToken: string,
    path: string,
    init: RequestInit = {},
  ): Promise<Response> {
    const url = new URL(path, this.accountBaseUrl);
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${accessToken}`);
    headers.set("Accept", "application/json");
    if (init.body !== undefined) headers.set("Content-Type", "application/json");

    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        headers,
        redirect: "error",
      });
    } catch {
      throw new AccountSelfServiceError(503, "ACCOUNT_PROVIDER_UNAVAILABLE");
    }

    if (response.ok) return response;
    if (response.status === 401) {
      throw new AccountSelfServiceError(428, "ACCOUNT_REAUTH_REQUIRED");
    }
    if (response.status === 403) {
      throw new AccountSelfServiceError(503, "ACCOUNT_SCOPE_NOT_READY");
    }
    if (response.status === 404) {
      throw new AccountSelfServiceError(404, "ACCOUNT_RESOURCE_NOT_FOUND");
    }
    if (response.status === 400) {
      throw new AccountSelfServiceError(400, "ACCOUNT_VALIDATION_FAILED");
    }
    throw new AccountSelfServiceError(503, "ACCOUNT_PROVIDER_UNAVAILABLE");
  }
}
