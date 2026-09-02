export interface StaffDirectorySecurity {
  totpConfigured: boolean | null;
  recoveryCodesConfigured: boolean | null;
}

export interface StaffDirectoryIdentity {
  issuer: string;
  subject: string;
}

export interface StaffDirectoryEntry {
  identity: StaffDirectoryIdentity;
  username: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string;
  enabled: boolean;
  security: StaffDirectorySecurity;
}

export interface IdentityDirectory {
  readonly issuer: string;
  search(query: string, limit?: number): Promise<StaffDirectoryEntry[]>;
  inspect(subject: string): Promise<StaffDirectoryEntry | null>;
}

interface KeycloakUserRepresentation {
  id?: string;
  username?: string;
  email?: string;
  emailVerified?: boolean;
  firstName?: string;
  lastName?: string;
  enabled?: boolean;
  totp?: boolean;
  requiredActions?: string[];
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
}

export class IdentityDirectoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdentityDirectoryError";
  }
}

export class KeycloakIdentityDirectory implements IdentityDirectory {
  readonly issuer: string;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly config: {
      baseUrl: string;
      realm: string;
      issuer: string;
      clientId: string;
      clientSecret: string;
    },
  ) {
    this.issuer = config.issuer.replace(/\/$/, "");
  }

  async search(query: string, limit = 10): Promise<StaffDirectoryEntry[]> {
    const normalized = query.trim();
    if (!normalized) return [];
    const safeLimit = Math.max(1, Math.min(limit, 10));
    const params = new URLSearchParams({
      search: normalized,
      max: String(safeLimit),
      briefRepresentation: "false",
    });
    const users = await this.adminGet<KeycloakUserRepresentation[]>(`users?${params.toString()}`);
    return users
      .filter((user): user is KeycloakUserRepresentation & { id: string; username: string } =>
        Boolean(user.id && user.username),
      )
      .slice(0, safeLimit)
      .map((user) => this.toEntry(user));
  }

  async inspect(subject: string): Promise<StaffDirectoryEntry | null> {
    const safeSubject = subject.trim();
    if (!safeSubject) return null;
    const response = await this.adminFetch(`users/${encodeURIComponent(safeSubject)}`);
    if (response.status === 404) return null;
    if (!response.ok) throw new IdentityDirectoryError(`Keycloak directory request failed (${response.status})`);
    const user = (await response.json()) as KeycloakUserRepresentation;
    if (!user.id || !user.username) return null;
    return this.toEntry(user as KeycloakUserRepresentation & { id: string; username: string });
  }

  private toEntry(user: KeycloakUserRepresentation & { id: string; username: string }): StaffDirectoryEntry {
    const requiredActions = new Set(user.requiredActions ?? []);
    const recoveryActionPending = requiredActions.has("CONFIGURE_RECOVERY_AUTHN_CODES");
    const displayName = [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || user.username;
    return {
      identity: { issuer: this.issuer, subject: user.id },
      username: user.username,
      email: user.email ?? null,
      emailVerified: user.emailVerified === true,
      displayName,
      enabled: user.enabled !== false,
      security: {
        totpConfigured: typeof user.totp === "boolean" ? user.totp : null,
        // view/query-users deliberately cannot read arbitrary credential lists. A pending
        // required action proves recovery is not configured; otherwise the state is unknown.
        recoveryCodesConfigured: recoveryActionPending ? false : null,
      },
    };
  }

  private async adminGet<T>(path: string): Promise<T> {
    const response = await this.adminFetch(path);
    if (!response.ok) throw new IdentityDirectoryError(`Keycloak directory request failed (${response.status})`);
    return (await response.json()) as T;
  }

  private async adminFetch(path: string): Promise<Response> {
    const token = await this.getToken();
    return fetch(
      `${this.config.baseUrl.replace(/\/$/, "")}/admin/realms/${encodeURIComponent(this.config.realm)}/${path}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      },
    );
  }

  private async getToken(): Promise<string> {
    const now = Date.now();
    if (this.token && this.token.expiresAt > now + 10_000) return this.token.value;

    const form = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      grant_type: "client_credentials",
    });
    const response = await fetch(
      `${this.config.baseUrl.replace(/\/$/, "")}/realms/${encodeURIComponent(this.config.realm)}/protocol/openid-connect/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form,
      },
    );
    if (!response.ok) throw new IdentityDirectoryError(`Keycloak directory authentication failed (${response.status})`);
    const body = (await response.json()) as TokenResponse;
    if (!body.access_token) throw new IdentityDirectoryError("Keycloak directory authentication returned no access token");
    const lifetime = Math.max(30, body.expires_in ?? 60);
    this.token = {
      value: body.access_token,
      expiresAt: now + lifetime * 1000,
    };
    return body.access_token;
  }
}
