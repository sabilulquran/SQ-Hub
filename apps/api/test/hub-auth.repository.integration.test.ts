import pg from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { PgHubAuthRepository } from "../src/modules/hub-auth/repository.js";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for integration tests");

const pool = new Pool({ connectionString: databaseUrl });
const repository = new PgHubAuthRepository(pool);
const context = { ipAddress: "127.0.0.1", userAgent: "vitest" };
const identity = {
  issuer: "https://login.sabilulquran.or.id/realms/sq-staff-staging",
  subject: "replacement-subject-001",
  displayName: "Replacement Test",
  username: "19870088",
  email: "replacement@example.test",
  emailVerified: true,
};

beforeEach(async () => {
  await pool.query(
    "TRUNCATE platform_audit_events, hub_oidc_transactions, hub_sessions CASCADE",
  );
});

afterAll(async () => {
  await pool.end();
});

describe("Hub session replacement persistence", () => {
  it("revokes the previous session and clears its delegated token atomically", async () => {
    const oldTokenHash = "a".repeat(64);
    const newTokenHash = "b".repeat(64);

    await repository.createSession({
      tokenHash: oldTokenHash,
      identity,
      accountRefreshTokenCiphertext: "sealed-old-refresh",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      context,
    });

    await repository.createSession({
      tokenHash: newTokenHash,
      identity,
      accountRefreshTokenCiphertext: "sealed-new-refresh",
      replaceSessionTokenHash: oldTokenHash,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      context,
    });

    const sessions = await pool.query<{
      tokenHash: string;
      ciphertext: string | null;
      revokedAt: Date | null;
    }>(
      `
        SELECT
          token_hash AS "tokenHash",
          account_refresh_token_ciphertext AS ciphertext,
          revoked_at AS "revokedAt"
        FROM hub_sessions
        WHERE token_hash IN ($1, $2)
        ORDER BY token_hash
      `,
      [oldTokenHash, newTokenHash],
    );

    expect(sessions.rows).toHaveLength(2);
    expect(sessions.rows[0]).toMatchObject({
      tokenHash: oldTokenHash,
      ciphertext: null,
    });
    expect(sessions.rows[0]?.revokedAt).toBeInstanceOf(Date);
    expect(sessions.rows[1]).toMatchObject({
      tokenHash: newTokenHash,
      ciphertext: "sealed-new-refresh",
      revokedAt: null,
    });

    const audit = await pool.query<{ action: string }>(
      `
        SELECT action
        FROM platform_audit_events
        WHERE action IN ('hub.auth.session.created', 'hub.auth.session.replaced')
      `,
    );
    expect(audit.rows.filter((row) => row.action === "hub.auth.session.created")).toHaveLength(2);
    expect(audit.rows.filter((row) => row.action === "hub.auth.session.replaced")).toHaveLength(1);
  });

  it("does not replace an active session when the new identity differs", async () => {
    const oldTokenHash = "e".repeat(64);
    const newTokenHash = "f".repeat(64);

    await repository.createSession({
      tokenHash: oldTokenHash,
      identity,
      accountRefreshTokenCiphertext: "sealed-old-refresh",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      context,
    });

    await expect(
      repository.createSession({
        tokenHash: newTokenHash,
        identity: { ...identity, subject: "different-subject" },
        accountRefreshTokenCiphertext: "sealed-new-refresh",
        replaceSessionTokenHash: oldTokenHash,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        context,
      }),
    ).rejects.toThrow("changed identity");

    const result = await pool.query<{
      tokenHash: string;
      ciphertext: string | null;
      revokedAt: Date | null;
    }>(
      `
        SELECT
          token_hash AS "tokenHash",
          account_refresh_token_ciphertext AS ciphertext,
          revoked_at AS "revokedAt"
        FROM hub_sessions
        WHERE token_hash IN ($1, $2)
        ORDER BY token_hash
      `,
      [oldTokenHash, newTokenHash],
    );

    expect(result.rows).toEqual([
      {
        tokenHash: oldTokenHash,
        ciphertext: "sealed-old-refresh",
        revokedAt: null,
      },
    ]);
  });

  it("rolls back the new session when the replacement target is no longer active", async () => {
    const newTokenHash = "c".repeat(64);

    await expect(
      repository.createSession({
        tokenHash: newTokenHash,
        identity,
        accountRefreshTokenCiphertext: "sealed-new-refresh",
        replaceSessionTokenHash: "d".repeat(64),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        context,
      }),
    ).rejects.toThrow("replacement is no longer active");

    const result = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM hub_sessions WHERE token_hash = $1",
      [newTokenHash],
    );
    expect(result.rows[0]?.count).toBe("0");
  });
});
