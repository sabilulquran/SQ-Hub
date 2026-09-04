export interface ManagedStaffIdentity {
  issuer: string;
  subject: string;
  username: string;
  email: string;
  emailVerified: boolean;
  firstName: string;
  lastName: string;
  enabled: boolean;
}

export interface CreateManagedStaffInput {
  username: string;
  email: string;
  emailVerified: true;
  firstName: string;
  lastName: string;
  enabled: boolean;
}

export interface IdentityManagement {
  readonly issuer: string;
  createStaff(input: CreateManagedStaffInput): Promise<ManagedStaffIdentity>;
  inspect(subject: string): Promise<ManagedStaffIdentity | null>;
  setEnabled(subject: string, enabled: boolean): Promise<{ changed: boolean; identity: ManagedStaffIdentity }>;
  sendPasswordInitialization(subject: string): Promise<void>;
}

interface KeycloakUserRepresentation {
  id?: string;
  username?: string;
  email?: string;
  emailVerified?: boolean;
  firstName?: string;
  lastName?: string;
  enabled?: boolean;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
}

export type IdentityManagementErrorCode =
  | "DUPLICATE_USERNAME"
  | "DUPLICATE_EMAIL"
  | "STAFF_NOT_FOUND"
  | "IDENTITY_MANAGEMENT_UNAVAILABLE";

export class IdentityManagementError extends Error {
  constructor(
    public readonly code: IdentityManagementErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "IdentityManagementError";
  }
}

export class KeycloakIdentityManagement implements IdentityManagement {
  readonly issuer: string;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly config: {
      baseUrl: string;
      realm: string;
      issuer: string;
      clientId: string;
      clientSecret: string;
      requestTimeoutMs?: number;
    },
  ) {
    this.issuer = config.issuer.replace(/\/$/, "");
  }

  async createStaff(input: CreateManagedStaffInput): Promise<ManagedStaffIdentity> {
    await this.assertUnique(input.username, input.email);
    const response = await this.adminFetch("users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: input.username,
        email: input.email,
        emailVerified: true,
        firstName: input.firstName,
        lastName: input.lastName,
        enabled: input.enabled,
        // Credential values are never accepted by this integration. Keycloak owns
        // password initialization through the required-action flow below.
        requiredActions: ["UPDATE_PASSWORD"],
      }),
    });
    if (response.status === 409) {
      throw new IdentityManagementError("DUPLICATE_USERNAME", "Username or email already exists");
    }
    if (!response.ok) this.unavailable("create", response.status);

    const location = response.headers.get("location");
    const subject = location?.split("/").filter(Boolean).at(-1);
    if (!subject) this.unavailable("create-location", response.status);
    const identity = await this.inspect(subject);
    if (!identity) this.unavailable("create-inspect", 502);
    return identity;
  }

  async inspect(subject: string): Promise<ManagedStaffIdentity | null> {
    const safeSubject = subject.trim();
    if (!safeSubject) return null;
    const response = await this.adminFetch(`users/${encodeURIComponent(safeSubject)}`);
    if (response.status === 404) return null;
    if (!response.ok) this.unavailable("inspect", response.status);
    return this.toIdentity((await response.json()) as KeycloakUserRepresentation);
  }

  async setEnabled(subject: string, enabled: boolean): Promise<{ changed: boolean; identity: ManagedStaffIdentity }> {
    const current = await this.inspect(subject);
    if (!current) throw new IdentityManagementError("STAFF_NOT_FOUND", "Staff identity was not found");
    if (current.enabled === enabled) return { changed: false, identity: current };

    const response = await this.adminFetch(`users/${encodeURIComponent(subject)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    if (response.status === 404) throw new IdentityManagementError("STAFF_NOT_FOUND", "Staff identity was not found");
    if (!response.ok) this.unavailable("set-enabled", response.status);
    return { changed: true, identity: { ...current, enabled } };
  }

  async sendPasswordInitialization(subject: string): Promise<void> {
    const current = await this.inspect(subject);
    if (!current) throw new IdentityManagementError("STAFF_NOT_FOUND", "Staff identity was not found");
    const response = await this.adminFetch(
      `users/${encodeURIComponent(subject)}/execute-actions-email`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(["UPDATE_PASSWORD"]),
      },
    );
    if (!response.ok) this.unavailable("required-action", response.status);
  }

  private async assertUnique(username: string, email: string): Promise<void> {
    const usernameMatches = await this.queryUsers({ username, exact: "true", max: "2" });
    if (usernameMatches.some((user) => user.username?.toLowerCase() === username.toLowerCase())) {
      throw new IdentityManagementError("DUPLICATE_USERNAME", "Username already exists");
    }
    const emailMatches = await this.queryUsers({ email, exact: "true", max: "2" });
    if (emailMatches.some((user) => user.email?.toLowerCase() === email.toLowerCase())) {
      throw new IdentityManagementError("DUPLICATE_EMAIL", "Email already exists");
    }
  }

  private async queryUsers(params: Record<string, string>): Promise<KeycloakUserRepresentation[]> {
    const response = await this.adminFetch(`users?${new URLSearchParams(params).toString()}`);
    if (!response.ok) this.unavailable("query", response.status);
    return (await response.json()) as KeycloakUserRepresentation[];
  }

  private toIdentity(user: KeycloakUserRepresentation): ManagedStaffIdentity {
    if (!user.id || !user.username || !user.email || !user.firstName || !user.lastName) {
      this.unavailable("incomplete-profile", 502);
    }
    return {
      issuer: this.issuer,
      subject: user.id,
      username: user.username,
      email: user.email,
      emailVerified: user.emailVerified === true,
      firstName: user.firstName,
      lastName: user.lastName,
      enabled: user.enabled !== false,
    };
  }

  private async adminFetch(path: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.getToken();
    return fetch(
      `${this.config.baseUrl.replace(/\/$/, "")}/admin/realms/${encodeURIComponent(this.config.realm)}/${path}`,
      {
        ...init,
        signal: init.signal ?? AbortSignal.timeout(this.config.requestTimeoutMs ?? 10_000),
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(init.headers ?? {}),
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
        signal: AbortSignal.timeout(this.config.requestTimeoutMs ?? 10_000),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form,
      },
    );
    if (!response.ok) this.unavailable("authentication", response.status);
    const body = (await response.json()) as TokenResponse;
    if (!body.access_token) this.unavailable("authentication-token", 502);
    const lifetime = Math.max(30, body.expires_in ?? 60);
    this.token = { value: body.access_token, expiresAt: now + lifetime * 1000 };
    return body.access_token;
  }

  private unavailable(operation: string, status: number): never {
    throw new IdentityManagementError(
      "IDENTITY_MANAGEMENT_UNAVAILABLE",
      `Identity management ${operation} failed (${status})`,
    );
  }
}
