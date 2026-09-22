import { randomUUID } from "node:crypto";

import type { Pool } from "pg";

import type { HubOidcAuthorizationTransaction } from "./oidc-provider.js";

export interface HubRequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

export interface HubSessionIdentity {
  issuer: string;
  subject: string;
  displayName: string;
  username: string | null;
  email: string | null;
  emailVerified: boolean | null;
}

export interface HubSessionRecord extends HubSessionIdentity {
  sessionId: string;
  accountRefreshTokenCiphertext: string | null;
  createdAt: Date;
  expiresAt: Date;
}

export interface HubAuthStore {
  createTransaction(input: {
    tokenHash: string;
    transaction: HubOidcAuthorizationTransaction;
    expiresAt: Date;
  }): Promise<void>;
  consumeTransaction(tokenHash: string): Promise<{
    transaction: HubOidcAuthorizationTransaction;
    expiresAt: Date;
  } | null>;
  createSession(input: {
    tokenHash: string;
    identity: HubSessionIdentity;
    accountRefreshTokenCiphertext: string | null;
    replaceSessionTokenHash?: string | null;
    expiresAt: Date;
    context: HubRequestContext;
  }): Promise<HubSessionRecord>;
  getSession(tokenHash: string, idleSeconds: number): Promise<HubSessionRecord | null>;
  updateAccountRefreshToken(sessionId: string, ciphertext: string): Promise<void>;
  revokeSession(tokenHash: string, context: HubRequestContext): Promise<void>;
}

interface TransactionRow {
  state: string;
  codeVerifier: string;
  nonce: string;
  returnPath: "/" | "/account" | null;
  replaceSessionTokenHash: string | null;
  expectedIssuer: string | null;
  expectedSubject: string | null;
  expiresAt: Date;
}

interface SessionRow {
  sessionId: string;
  identityIssuer: string;
  identitySubject: string;
  displayName: string;
  username: string | null;
  email: string | null;
  emailVerified: boolean | null;
  accountRefreshTokenCiphertext: string | null;
  createdAt: Date;
  expiresAt: Date;
}

export class PgHubAuthRepository implements HubAuthStore {
  constructor(private readonly pool: Pool) {}

  async createTransaction(input: {
    tokenHash: string;
    transaction: HubOidcAuthorizationTransaction;
    expiresAt: Date;
  }): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO hub_oidc_transactions (
          id,
          token_hash,
          state,
          code_verifier,
          nonce,
          return_path,
          replace_session_token_hash,
          expected_identity_issuer,
          expected_identity_subject,
          expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `,
      [
        randomUUID(),
        input.tokenHash,
        input.transaction.state,
        input.transaction.codeVerifier,
        input.transaction.nonce,
        input.transaction.returnPath ?? null,
        input.transaction.replaceSessionTokenHash ?? null,
        input.transaction.expectedIssuer ?? null,
        input.transaction.expectedSubject ?? null,
        input.expiresAt,
      ],
    );
  }

  async consumeTransaction(tokenHash: string): Promise<{
    transaction: HubOidcAuthorizationTransaction;
    expiresAt: Date;
  } | null> {
    const result = await this.pool.query<TransactionRow>(
      `
        DELETE FROM hub_oidc_transactions
        WHERE token_hash = $1
        RETURNING
          state,
          code_verifier AS "codeVerifier",
          nonce,
          return_path AS "returnPath",
          replace_session_token_hash AS "replaceSessionTokenHash",
          expected_identity_issuer AS "expectedIssuer",
          expected_identity_subject AS "expectedSubject",
          expires_at AS "expiresAt"
      `,
      [tokenHash],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      transaction: {
        state: row.state,
        codeVerifier: row.codeVerifier,
        nonce: row.nonce,
        ...(row.returnPath ? { returnPath: row.returnPath } : {}),
        ...(row.replaceSessionTokenHash
          ? { replaceSessionTokenHash: row.replaceSessionTokenHash }
          : {}),
        ...(row.expectedIssuer ? { expectedIssuer: row.expectedIssuer } : {}),
        ...(row.expectedSubject ? { expectedSubject: row.expectedSubject } : {}),
      },
      expiresAt: row.expiresAt,
    };
  }

  async createSession(input: {
    tokenHash: string;
    identity: HubSessionIdentity;
    accountRefreshTokenCiphertext: string | null;
    replaceSessionTokenHash?: string | null;
    expiresAt: Date;
    context: HubRequestContext;
  }): Promise<HubSessionRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const sessionId = randomUUID();
      let replacedSession:
        | {
            sessionId: string;
            identityIssuer: string;
            identitySubject: string;
            expiresAt: Date;
          }
        | undefined;

      if (input.replaceSessionTokenHash) {
        const replacement = await client.query<{
          sessionId: string;
          identityIssuer: string;
          identitySubject: string;
          expiresAt: Date;
        }>(
          `
            UPDATE hub_sessions
            SET revoked_at = now(),
                account_refresh_token_ciphertext = NULL
            WHERE token_hash = $1
              AND identity_issuer = $2
              AND identity_subject = $3
              AND revoked_at IS NULL
              AND expires_at > now()
            RETURNING
              id AS "sessionId",
              identity_issuer AS "identityIssuer",
              identity_subject AS "identitySubject",
              expires_at AS "expiresAt"
          `,
          [
            input.replaceSessionTokenHash,
            input.identity.issuer,
            input.identity.subject,
          ],
        );
        replacedSession = replacement.rows[0];
        if (!replacedSession) {
          throw new Error("Hub session selected for replacement is no longer active or changed identity");
        }
      }

      const effectiveExpiresAt = replacedSession?.expiresAt ?? input.expiresAt;

      const result = await client.query<SessionRow>(
        `
          INSERT INTO hub_sessions (
            id,
            token_hash,
            identity_issuer,
            identity_subject,
            display_name,
            username,
            email,
            email_verified,
            account_refresh_token_ciphertext,
            expires_at,
            ip_address,
            user_agent
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          RETURNING
            id AS "sessionId",
            identity_issuer AS "identityIssuer",
            identity_subject AS "identitySubject",
            display_name AS "displayName",
            username,
            email,
            email_verified AS "emailVerified",
            account_refresh_token_ciphertext AS "accountRefreshTokenCiphertext",
            created_at AS "createdAt",
            expires_at AS "expiresAt"
        `,
        [
          sessionId,
          input.tokenHash,
          input.identity.issuer,
          input.identity.subject,
          input.identity.displayName,
          input.identity.username,
          input.identity.email,
          input.identity.emailVerified,
          input.accountRefreshTokenCiphertext,
          effectiveExpiresAt,
          input.context.ipAddress,
          input.context.userAgent,
        ],
      );
      const row = result.rows[0];
      if (!row) throw new Error("hub session insert returned no row");

      await client.query(
        `
          INSERT INTO platform_audit_events (
            id, actor_kind, actor_ref, action, target_type, target_ref, outcome, payload
          ) VALUES ($1, 'human', $2, 'hub.auth.session.created', 'hub_session', $3, 'succeeded', $4::jsonb)
        `,
        [
          randomUUID(),
          input.identity.subject,
          sessionId,
          JSON.stringify({ issuer: input.identity.issuer }),
        ],
      );

      if (replacedSession) {
        await client.query(
          `
            INSERT INTO platform_audit_events (
              id, actor_kind, actor_ref, action, target_type, target_ref, outcome, payload
            ) VALUES ($1, 'human', $2, 'hub.auth.session.replaced', 'hub_session', $3, 'succeeded', $4::jsonb)
          `,
          [
            randomUUID(),
            replacedSession.identitySubject,
            replacedSession.sessionId,
            JSON.stringify({
              issuer: replacedSession.identityIssuer,
              replacementSessionId: sessionId,
            }),
          ],
        );
      }

      await client.query("COMMIT");

      return {
        sessionId: row.sessionId,
        issuer: row.identityIssuer,
        subject: row.identitySubject,
        displayName: row.displayName,
        username: row.username,
        email: row.email,
        emailVerified: row.emailVerified,
        accountRefreshTokenCiphertext: row.accountRefreshTokenCiphertext,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getSession(tokenHash: string, idleSeconds: number): Promise<HubSessionRecord | null> {
    const result = await this.pool.query<SessionRow>(
      `
        SELECT
          id AS "sessionId",
          identity_issuer AS "identityIssuer",
          identity_subject AS "identitySubject",
          display_name AS "displayName",
          username,
          email,
          email_verified AS "emailVerified",
          account_refresh_token_ciphertext AS "accountRefreshTokenCiphertext",
          created_at AS "createdAt",
          expires_at AS "expiresAt"
        FROM hub_sessions
        WHERE token_hash = $1
          AND revoked_at IS NULL
          AND expires_at > now()
          AND last_seen_at > now() - ($2::double precision * interval '1 second')
        LIMIT 1
      `,
      [tokenHash, idleSeconds],
    );
    const row = result.rows[0];
    if (!row) return null;

    await this.pool.query(
      `UPDATE hub_sessions SET last_seen_at = now() WHERE id = $1`,
      [row.sessionId],
    );

    return {
      sessionId: row.sessionId,
      issuer: row.identityIssuer,
      subject: row.identitySubject,
      displayName: row.displayName,
      username: row.username,
      email: row.email,
      emailVerified: row.emailVerified,
      accountRefreshTokenCiphertext: row.accountRefreshTokenCiphertext,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
    };
  }

  async updateAccountRefreshToken(sessionId: string, ciphertext: string): Promise<void> {
    await this.pool.query(
      `
        UPDATE hub_sessions
        SET account_refresh_token_ciphertext = $2
        WHERE id = $1
          AND revoked_at IS NULL
      `,
      [sessionId, ciphertext],
    );
  }

  async revokeSession(tokenHash: string, context: HubRequestContext): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{
        sessionId: string;
        identityIssuer: string;
        identitySubject: string;
      }>(
        `
          UPDATE hub_sessions
          SET revoked_at = now(),
              account_refresh_token_ciphertext = NULL
          WHERE token_hash = $1
            AND revoked_at IS NULL
          RETURNING
            id AS "sessionId",
            identity_issuer AS "identityIssuer",
            identity_subject AS "identitySubject"
        `,
        [tokenHash],
      );
      const row = result.rows[0];
      if (row) {
        await client.query(
          `
            INSERT INTO platform_audit_events (
              id, actor_kind, actor_ref, action, target_type, target_ref, outcome, payload
            ) VALUES ($1, 'human', $2, 'hub.auth.logout', 'hub_session', $3, 'succeeded', $4::jsonb)
          `,
          [
            randomUUID(),
            row.identitySubject,
            row.sessionId,
            JSON.stringify({
              issuer: row.identityIssuer,
              ipAddress: context.ipAddress,
              userAgent: context.userAgent,
            }),
          ],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
