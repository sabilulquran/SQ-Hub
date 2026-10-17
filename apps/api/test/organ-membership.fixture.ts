import type { IdentityDirectory, StaffDirectoryEntry } from "../src/modules/identity-directory/client.js";
import type { IdentityManagement, ManagedStaffIdentity } from "../src/modules/identity-management/client.js";

export const issuer = "https://login.example.test/realms/sq-staff";

/** In-memory synthetic Keycloak staff realm shared by the directory and identity-management fakes. */
export class FakeStaffRealm {
  readonly users = new Map<string, ManagedStaffIdentity>();
  readonly calls: string[] = [];
  failActivationEmail = false;
  failTotpRequirement = false;
  private next = 1;

  add(user: Partial<ManagedStaffIdentity> & { subject: string; username: string }): ManagedStaffIdentity {
    const identity: ManagedStaffIdentity = {
      issuer,
      email: `${user.username}@example.test`,
      emailVerified: true,
      firstName: "Synthetic",
      lastName: "Person",
      enabled: true,
      requiredActions: [],
      totp: false,
      ...user,
    };
    this.users.set(identity.subject, identity);
    return identity;
  }

  directory(): IdentityDirectory {
    return {
      issuer,
      search: async () => [...this.users.values()].map(toEntry),
      inspect: async (subject) => {
        const user = this.users.get(subject);
        return user ? toEntry(user) : null;
      },
    };
  }

  management(): IdentityManagement {
    return {
      issuer,
      findByUsername: async (username) => [...this.users.values()].find((user) => user.username === username) ?? null,
      createStaff: async () => {
        throw new Error("not used");
      },
      inspect: async (subject) => this.users.get(subject) ?? null,
      setEnabled: async (subject, enabled) => {
        const user = this.users.get(subject);
        if (!user) throw new Error("not found");
        this.calls.push(`setEnabled:${subject}:${enabled}`);
        if (user.enabled === enabled) return { changed: false, identity: user };
        const updated = { ...user, enabled };
        this.users.set(subject, updated);
        return { changed: true, identity: updated };
      },
      sendPasswordInitialization: async (subject) => {
        this.calls.push(`passwordInit:${subject}`);
      },
      findByUsernameOrEmail: async (email) =>
        [...this.users.values()].filter(
          (user) => user.username.toLowerCase() === email.toLowerCase() || user.email.toLowerCase() === email.toLowerCase(),
        ),
      createOrganMember: async (input) => {
        this.calls.push("createOrganMember");
        const subject = `organ-subject-${this.next++}`;
        return this.add({
          subject,
          username: input.email,
          email: input.email,
          emailVerified: false,
          firstName: input.firstName,
          lastName: input.lastName,
          // Like production (Keycloak 26, declarative user profile): no Hub marker attribute survives.
          requiredActions: ["VERIFY_EMAIL", "UPDATE_PASSWORD", "CONFIGURE_TOTP"],
        });
      },
      sendOrganActivation: async (subject) => {
        this.calls.push(`activation:${subject}`);
        if (this.failActivationEmail) throw new Error("synthetic mail failure");
      },
      requireTotpSetup: async (subject) => {
        this.calls.push(`requireTotp:${subject}`);
        if (this.failTotpRequirement) throw new Error("synthetic keycloak failure");
        const user = this.users.get(subject)!;
        if (user.requiredActions?.includes("CONFIGURE_TOTP")) return "already_required";
        this.users.set(subject, { ...user, requiredActions: [...(user.requiredActions ?? []), "CONFIGURE_TOTP"] });
        return "set";
      },
      linkEmployee: async (subject, employeeId) => {
        this.calls.push(`linkEmployee:${subject}`);
        const user = { ...this.users.get(subject)!, employeeId };
        this.users.set(subject, user);
        return user;
      },
    };
  }
}

function toEntry(user: ManagedStaffIdentity): StaffDirectoryEntry {
  return {
    identity: { issuer: user.issuer, subject: user.subject },
    username: user.username,
    email: user.email,
    emailVerified: user.emailVerified,
    displayName: `${user.firstName} ${user.lastName}`,
    enabled: user.enabled,
    security: { totpConfigured: user.totp ?? null, recoveryCodesConfigured: null },
  };
}
