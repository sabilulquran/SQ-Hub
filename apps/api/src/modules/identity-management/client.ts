export interface ManagedStaffIdentity {
  issuer: string;
  subject: string;
  username: string;
  email: string;
  emailVerified: boolean;
  firstName: string;
  lastName: string;
  enabled: boolean;
  requiredActions?: string[];
  employeeId?: string;
  /** Keycloak `totp` flag: an OTP credential is configured. */
  totp?: boolean;
}

export interface CreateOrganMemberInput {
  email: string;
  firstName: string;
  lastName: string;
}

export interface CreateManagedStaffInput {
  username: string;
  email: string;
  employeeId: string;
  firstName: string;
  lastName: string;
  enabled: boolean;
}

export interface IdentityManagement {
  readonly issuer: string;
  findByUsername(username: string): Promise<ManagedStaffIdentity | null>;
  createStaff(input: CreateManagedStaffInput): Promise<ManagedStaffIdentity>;
  inspect(subject: string): Promise<ManagedStaffIdentity | null>;
  setEnabled(subject: string, enabled: boolean): Promise<{ changed: boolean; identity: ManagedStaffIdentity }>;
  sendPasswordInitialization(subject: string): Promise<void>;
  /** Every identity whose username or e-mail equals the given e-mail (exact, case-insensitive). */
  findByUsernameOrEmail(email: string): Promise<ManagedStaffIdentity[]>;
  createOrganMember(input: CreateOrganMemberInput): Promise<ManagedStaffIdentity>;
  sendOrganActivation(subject: string): Promise<void>;
  requireTotpSetup(subject: string): Promise<"set" | "already_required">;
  linkEmployee(subject: string, employeeId: string): Promise<ManagedStaffIdentity>;
}

interface KeycloakUserRepresentation {
  id?: string;
  username?: string;
  email?: string;
  emailVerified?: boolean;
  firstName?: string;
  lastName?: string;
  enabled?: boolean;
  requiredActions?: string[];
  attributes?: Record<string, string[]>;
  totp?: boolean;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
}

export type IdentityManagementErrorCode =
  | "DUPLICATE_USERNAME"
  | "DUPLICATE_EMAIL"
  | "STAFF_NOT_FOUND"
  | "IDENTITY_ACTION_NOT_PENDING"
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
        emailVerified: false,
        firstName: input.firstName,
        lastName: input.lastName,
        enabled: input.enabled,
        // Credential values are never accepted by this integration. Keycloak owns
        // password initialization through the required-action flow below.
        requiredActions: ["VERIFY_EMAIL", "UPDATE_PASSWORD"],
        attributes: { hcisEmployeeId: [input.employeeId] },
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

  async findByUsername(username: string): Promise<ManagedStaffIdentity | null> {
    const matches = await this.queryUsers({ username, exact: "true", max: "2" });
    const exact = matches.filter((user) => user.username?.toLowerCase() === username.toLowerCase());
    if (exact.length > 1) this.unavailable("ambiguous-username", 409);
    if (!exact[0]?.id) return null;
    return this.inspect(exact[0].id);
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
    const verified = await this.inspect(subject);
    if (!verified || verified.enabled !== enabled) this.unavailable("set-enabled-verify", 502);
    return { changed: true, identity: verified };
  }

  async sendPasswordInitialization(subject: string): Promise<void> {
    const current = await this.inspect(subject);
    if (!current) throw new IdentityManagementError("STAFF_NOT_FOUND", "Staff identity was not found");
    if (!current.employeeId || !current.requiredActions?.includes("UPDATE_PASSWORD")) {
      throw new IdentityManagementError("IDENTITY_ACTION_NOT_PENDING", "Password initialization is not pending");
    }
    const response = await this.adminFetch(
      `users/${encodeURIComponent(subject)}/execute-actions-email?lifespan=43200`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(["VERIFY_EMAIL", "UPDATE_PASSWORD"]),
      },
    );
    if (!response.ok) this.unavailable("required-action", response.status);
  }

  async findByUsernameOrEmail(email: string): Promise<ManagedStaffIdentity[]> {
    const needle = email.trim().toLowerCase();
    const [byUsername, byEmail] = await Promise.all([
      this.queryUsers({ username: needle, exact: "true", max: "2" }),
      this.queryUsers({ email: needle, exact: "true", max: "2" }),
    ]);
    const ids = new Set<string>();
    for (const user of [...byUsername, ...byEmail]) {
      if (!user.id) continue;
      if (user.username?.toLowerCase() === needle || user.email?.toLowerCase() === needle) ids.add(user.id);
    }
    const identities: ManagedStaffIdentity[] = [];
    for (const id of ids) {
      const identity = await this.inspect(id);
      if (identity) identities.push(identity);
    }
    return identities;
  }

  async createOrganMember(input: CreateOrganMemberInput): Promise<ManagedStaffIdentity> {
    const email = input.email.trim().toLowerCase();
    await this.assertUnique(email, email);
    const response = await this.adminFetch("users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        // ADR-0005: staff without NIP use their e-mail as username. Hub never invents a staff number.
        username: email,
        email,
        emailVerified: false,
        firstName: input.firstName,
        lastName: input.lastName,
        enabled: true,
        // No credential value is ever sent. Two-step verification is mandatory for organ members.
        // Hub's own provisioning record, not a Keycloak attribute, marks the identity as Path B:
        // the staff realm's declarative user profile drops unmanaged attributes.
        requiredActions: ["VERIFY_EMAIL", "UPDATE_PASSWORD", "CONFIGURE_TOTP"],
      }),
    });
    if (response.status === 409) {
      throw new IdentityManagementError("DUPLICATE_USERNAME", "Username or email already exists");
    }
    if (!response.ok) this.unavailable("create-organ-member", response.status);
    const location = response.headers.get("location");
    const subject = location?.split("/").filter(Boolean).at(-1);
    if (!subject) this.unavailable("create-organ-member-location", response.status);
    const identity = await this.inspect(subject);
    if (!identity) this.unavailable("create-organ-member-inspect", 502);
    return identity;
  }

  /** The caller must first confirm from Hub's own record that Hub created this identity for Path B. */
  async sendOrganActivation(subject: string): Promise<void> {
    const current = await this.inspect(subject);
    if (!current) throw new IdentityManagementError("STAFF_NOT_FOUND", "Staff identity was not found");
    if (current.employeeId || !current.requiredActions?.includes("UPDATE_PASSWORD")) {
      throw new IdentityManagementError("IDENTITY_ACTION_NOT_PENDING", "Organ activation is not pending");
    }
    const response = await this.adminFetch(
      `users/${encodeURIComponent(subject)}/execute-actions-email?lifespan=43200`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(["VERIFY_EMAIL", "UPDATE_PASSWORD"]),
      },
    );
    if (!response.ok) this.unavailable("organ-activation", response.status);
  }

  async requireTotpSetup(subject: string): Promise<"set" | "already_required"> {
    const user = await this.rawUser(subject);
    const actions = user.requiredActions ?? [];
    if (actions.includes("CONFIGURE_TOTP")) return "already_required";
    const response = await this.adminFetch(`users/${encodeURIComponent(subject)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requiredActions: [...actions, "CONFIGURE_TOTP"] }),
    });
    if (response.status === 404) throw new IdentityManagementError("STAFF_NOT_FOUND", "Staff identity was not found");
    if (!response.ok) this.unavailable("require-totp", response.status);
    const verified = await this.rawUser(subject);
    if (!verified.requiredActions?.includes("CONFIGURE_TOTP")) this.unavailable("require-totp-verify", 502);
    return "set";
  }

  async linkEmployee(subject: string, employeeId: string): Promise<ManagedStaffIdentity> {
    const user = await this.rawUser(subject);
    const response = await this.adminFetch(`users/${encodeURIComponent(subject)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      // Keycloak replaces the whole attribute map, so keep every existing attribute.
      body: JSON.stringify({ attributes: { ...(user.attributes ?? {}), hcisEmployeeId: [employeeId] } }),
    });
    if (response.status === 404) throw new IdentityManagementError("STAFF_NOT_FOUND", "Staff identity was not found");
    if (!response.ok) this.unavailable("link-employee", response.status);
    const verified = await this.inspect(subject);
    if (!verified || verified.employeeId !== employeeId) this.unavailable("link-employee-verify", 502);
    return verified;
  }

  private async rawUser(subject: string): Promise<KeycloakUserRepresentation> {
    const response = await this.adminFetch(`users/${encodeURIComponent(subject.trim())}`);
    if (response.status === 404) throw new IdentityManagementError("STAFF_NOT_FOUND", "Staff identity was not found");
    if (!response.ok) this.unavailable("inspect", response.status);
    return (await response.json()) as KeycloakUserRepresentation;
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
    if (!user.id || !user.username || !user.email || !user.firstName || !user.lastName || typeof user.enabled !== "boolean") {
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
      enabled: user.enabled,
      requiredActions: user.requiredActions ?? [],
      ...(user.attributes?.hcisEmployeeId?.[0] ? { employeeId: user.attributes.hcisEmployeeId[0] } : {}),
      ...(typeof user.totp === "boolean" ? { totp: user.totp } : {}),
    };
  }

  private async adminFetch(path: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.getToken();
    return fetch(
      `${this.config.baseUrl.replace(/\/$/, "")}/admin/realms/${encodeURIComponent(this.config.realm)}/${path}`,
      {
        ...init,
        redirect: "error",
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
        redirect: "error",
        signal: AbortSignal.timeout(this.config.requestTimeoutMs ?? 10_000),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form,
      },
    );
    if (!response.ok) this.unavailable("authentication", response.status);
    const body = (await response.json()) as TokenResponse;
    if (!body.access_token) this.unavailable("authentication-token", 502);
    const lifetime = typeof body.expires_in === "number" && body.expires_in > 0
      ? body.expires_in
      : 60;
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
