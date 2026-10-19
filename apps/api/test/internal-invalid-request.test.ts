import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { buildApp } from "../src/app.js";
import { invalidRequestFields, invalidRequestIssues } from "../src/invalid-request.js";
import type { KirimService } from "../src/modules/kirim/service.js";
import { registerKirimInternalRoutes } from "../src/modules/kirim/routes-internal.js";
import { registerOrganizationDirectoryRoutes } from "../src/modules/organization-directory/routes.js";

const identity = {
  issuer: "https://login.sabilulquran.or.id/realms/sq-staff-staging",
  subject: "user-001",
};

/** A value that must never be echoed back: it stands in for personal data in a body. */
const SECRET_VALUE = "Siti Aisyah Rahmawati";

function accessApp() {
  return buildApp({
    accessService: {
      checkAccess: async () => ({ allowed: true, applicationKey: "hcis", decision: "active_grant" }),
    },
    verifyMachineToken: async () => ({ clientId: "spmb-api-staging" }),
  });
}

describe("POST /internal/v1/application-access/check", () => {
  it("names the rejected field path for an unknown key inside identity", async () => {
    const app = accessApp();
    const response = await app.inject({
      method: "POST",
      url: "/internal/v1/application-access/check",
      headers: { authorization: "Bearer allowed" },
      payload: { identity: { ...identity, name: SECRET_VALUE }, applicationKey: "spmb" },
    });
    await app.close();

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "INVALID_REQUEST", fields: ["identity.name"] });
  });

  it("never puts the submitted value in the answer", async () => {
    const app = accessApp();
    const response = await app.inject({
      method: "POST",
      url: "/internal/v1/application-access/check",
      headers: { authorization: "Bearer allowed" },
      payload: {
        identity: { ...identity, subject: 42, name: SECRET_VALUE },
        applicationKey: "spmb",
      },
    });
    await app.close();

    expect(response.statusCode).toBe(400);
    expect(response.body).not.toContain(SECRET_VALUE);
    expect(response.json().fields).toEqual(
      expect.arrayContaining(["identity.subject", "identity.name"]),
    );
  });

  it("names a rejected key at the top level of the body", async () => {
    const app = accessApp();
    const response = await app.inject({
      method: "POST",
      url: "/internal/v1/application-access/check",
      headers: { authorization: "Bearer allowed" },
      payload: { identity, applicationKey: "hcis", permission: "payroll.admin" },
    });
    await app.close();

    expect(response.json()).toEqual({ error: "INVALID_REQUEST", fields: ["permission"] });
  });

  it("keeps the submitted value out of the request log as well", async () => {
    const lines: string[] = [];
    const app = buildApp({
      accessService: {
        checkAccess: async () => ({ allowed: true, applicationKey: "hcis", decision: "active_grant" }),
      },
      verifyMachineToken: async () => ({ clientId: "spmb-api-staging" }),
      logStream: {
        write(chunk: string) {
          lines.push(chunk);
          return true;
        },
      } as unknown as NodeJS.WritableStream,
    });
    await app.inject({
      method: "POST",
      url: "/internal/v1/application-access/check",
      headers: { authorization: "Bearer allowed" },
      payload: { identity: { ...identity, name: SECRET_VALUE }, applicationKey: "spmb" },
    });
    await app.close();

    const log = lines.join("");
    expect(log).toContain("identity.name");
    expect(log).toContain("unrecognized_keys");
    expect(log).not.toContain(SECRET_VALUE);
  });
});

describe("POST /internal/kirim/messages", () => {
  function kirimApp() {
    const app = Fastify();
    registerKirimInternalRoutes(app, {
      service: {
        requireConsumer: async () => ({ id: "c1", clientId: "spmb-api", aktif: true }),
      } as unknown as KirimService,
      verifyMachineToken: async () => ({ clientId: "spmb-api" }),
    });
    return app;
  }

  it("names the rejected field path without echoing the value", async () => {
    const app = kirimApp();
    const response = await app.inject({
      method: "POST",
      url: "/internal/kirim/messages",
      headers: { authorization: "Bearer allowed", "idempotency-key": "k-1" },
      payload: {
        device: "wa-utama",
        jenis: "notifikasi",
        to: "6281234567890",
        text: "halo",
        nama: SECRET_VALUE,
      },
    });
    await app.close();

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("invalid_request");
    expect(response.json().error.fields).toEqual(["nama"]);
    expect(response.body).not.toContain(SECRET_VALUE);
  });

  it("names the rejected field path on an opt-out body", async () => {
    const app = kirimApp();
    const response = await app.inject({
      method: "POST",
      url: "/internal/kirim/optouts",
      headers: { authorization: "Bearer allowed" },
      payload: { nomor: "6281234567890", cakupan: "consumer", alasan: "diminta", catatan: SECRET_VALUE },
    });
    await app.close();

    expect(response.statusCode).toBe(400);
    expect(response.json().error.fields).toEqual(["catatan"]);
    expect(response.body).not.toContain(SECRET_VALUE);
  });
});

describe("GET /internal/v1/organization-directory", () => {
  it("names the rejected query field without echoing the value", async () => {
    const app = Fastify();
    registerOrganizationDirectoryRoutes(app, {
      read: async () => null,
      verifyMachineToken: async () => ({ clientId: "hcis-api" }),
    });
    const response = await app.inject({
      method: "GET",
      url: `/internal/v1/organization-directory/units?nama=${encodeURIComponent(SECRET_VALUE)}`,
      headers: { authorization: "Bearer allowed" },
    });
    await app.close();

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "INVALID_REQUEST", fields: ["nama"] });
    expect(response.body).not.toContain(SECRET_VALUE);
  });
});

describe("invalidRequestIssues", () => {
  it("reports a path and an issue code per problem", () => {
    const schema = z.object({ identity: z.object({ subject: z.string() }).strict() }).strict();
    const parsed = schema.safeParse({ identity: { subject: 1, name: "x" } });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;

    expect(invalidRequestIssues(parsed.error)).toEqual([
      { path: "identity.subject", code: "invalid_type" },
      { path: "identity.name", code: "unrecognized_keys" },
    ]);
  });

  it("reduces a caller-supplied key to the characters a field name may hold", () => {
    const schema = z.object({}).strict();
    const parsed = schema.safeParse({ [`a b<script>${"x".repeat(200)}`]: 1 });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;

    const [field] = invalidRequestFields(parsed.error);
    expect(field).toBe(`a?b?script?${"x".repeat(53)}`);
    expect(field).toHaveLength(64);
  });

  it("caps how many fields are reported", () => {
    const schema = z.object({}).strict();
    const payload = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`f${i}`, 1]));
    const parsed = schema.safeParse(payload);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;

    expect(invalidRequestFields(parsed.error)).toHaveLength(20);
  });

  it("labels a cross-field rule that belongs to the body as a whole", () => {
    const schema = z.object({ a: z.string().optional() }).strict().refine(() => false, { message: "nope" });
    const parsed = schema.safeParse({});
    expect(parsed.success).toBe(false);
    if (parsed.success) return;

    expect(invalidRequestFields(parsed.error)).toEqual(["(body)"]);
  });
});
