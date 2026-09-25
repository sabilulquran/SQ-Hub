import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { MachineAuthError, readBearerToken, type VerifyMachineToken } from "../application-access/machine-auth.js";
import { organizationDirectoryUnitSchema, organizationDirectoryPersonSchema } from "./contract.js";
import type { Projection } from "./repository.js";

export const DIRECTORY_PREFIX = "/internal/v1/organization-directory";
const unitId = organizationDirectoryUnitSchema.shape.id;
const personId = organizationDirectoryPersonSchema.shape.id;
const search = z.object({
  q: z.string().trim().max(200).default(""),
  active: z.enum(["true", "false"]).default("true"),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(2048).optional(),
}).strict();
const peopleSearch = search.extend({ unitId: unitId.optional() });
const cursorSchema = z.object({ version: z.string(), filter: z.string(), id: z.string() }).strict();

export function directoryMetadata(projection: Projection, now: Date) {
  const age = Math.max(0, now.getTime() - Date.parse(projection.synchronizedAt));
  return {
    source: "hcis", version: projection.snapshot.version, asOf: projection.snapshot.asOf,
    synchronizedAt: projection.synchronizedAt, stale: age >= 900_000,
    staleForSeconds: Math.max(0, Math.floor((age - 900_000) / 1000)),
  };
}

class ReadError extends Error {
  constructor(public readonly status: number, public readonly code: string) { super(code); }
}
function invalid(): never { throw new ReadError(400, "INVALID_REQUEST"); }
function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.output<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) return invalid();
  return parsed.data;
}
function found<T>(value: T | undefined): T {
  if (value === undefined) throw new ReadError(404, "DIRECTORY_ENTRY_NOT_FOUND");
  return value;
}

function page<T extends { id: string }>(items: T[], query: z.infer<typeof peopleSearch>, version: string, kind: string) {
  const filter = createHash("sha256").update(JSON.stringify([kind, query.q, query.active, query.unitId ?? null, query.limit])).digest("hex");
  let after = "";
  if (query.cursor) {
    try {
      const cursor = cursorSchema.parse(JSON.parse(Buffer.from(query.cursor, "base64url").toString("utf8")));
      if (cursor.version !== version || cursor.filter !== filter) return invalid();
      after = cursor.id;
    } catch { return invalid(); }
  }
  const ordered = items.filter((item) => item.id > after).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const selected = ordered.slice(0, query.limit);
  const last = selected.at(-1);
  const nextCursor = ordered.length > selected.length && last
    ? Buffer.from(JSON.stringify({ version, filter, id: last.id })).toString("base64url") : null;
  return { items: selected, nextCursor };
}

export function registerOrganizationDirectoryRoutes(app: FastifyInstance, input: {
  read: () => Promise<Projection | null>;
  verifyMachineToken: VerifyMachineToken;
  now?: () => Date;
}) {
  app.register(async (routes) => {
    routes.addHook("onRequest", async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const token = readBearerToken(request.headers.authorization);
      if (!token) return reply.code(401).send({ error: "UNAUTHENTICATED" });
      try { await input.verifyMachineToken(token); }
      catch (error) {
        const forbidden = error instanceof MachineAuthError && error.code === "FORBIDDEN_CLIENT";
        return reply.code(forbidden ? 403 : 401).send({ error: forbidden ? "FORBIDDEN_CLIENT" : "UNAUTHENTICATED" });
      }
    });
    routes.setErrorHandler((error, request, reply) => {
      if (error instanceof ReadError) return reply.code(error.status).send({ error: error.code });
      request.log.error({ category: "directory_read_unavailable" }, "directory read failed");
      return reply.code(503).send({ error: "DIRECTORY_UNAVAILABLE" });
    });
    async function projection() {
      const value = await input.read();
      if (!value) throw new ReadError(503, "DIRECTORY_UNAVAILABLE");
      return { value, directory: directoryMetadata(value, (input.now ?? (() => new Date()))()) };
    }
    routes.get("/units", async (request) => {
      const query = parse(search, request.query);
      const { value, directory } = await projection();
      const all = [...value.snapshot.units, ...value.tombstones.units];
      const items = all.filter((u) => {
        const active = u.active && "effectiveFrom" in u && u.effectiveFrom <= value.snapshot.asOf && (!u.effectiveTo || u.effectiveTo >= value.snapshot.asOf);
        return active === (query.active === "true") && u.name.toLocaleLowerCase().includes(query.q.toLocaleLowerCase());
      });
      return { ...page(items, query, directory.version, "units"), directory };
    });
    routes.get("/units/:unitId", async (request) => {
      const params = parse(z.object({ unitId }).strict(), request.params);
      parse(z.object({}).strict(), request.query);
      const { value, directory } = await projection();
      return { item: found([...value.snapshot.units, ...value.tombstones.units].find((u) => u.id === params.unitId)), directory };
    });
    routes.get("/units/:unitId/ancestry", async (request) => {
      const params = parse(z.object({ unitId }).strict(), request.params);
      parse(z.object({}).strict(), request.query);
      const { value, directory } = await projection();
      const byId = new Map(value.snapshot.units.map((u) => [u.id, u]));
      if (!byId.has(params.unitId) && !value.tombstones.units.some((u) => u.id === params.unitId)) found(undefined);
      const items = [];
      const seen = new Set<string>();
      let id: string | null = params.unitId;
      while (id !== null) {
        const unit = byId.get(id);
        if (!unit || seen.has(id)) throw new ReadError(409, "DIRECTORY_INTEGRITY_ERROR");
        seen.add(id); items.push(unit); id = unit.parentUnitId;
      }
      return { items, directory };
    });
    routes.get("/people", async (request) => {
      const query = parse(peopleSearch, request.query);
      const { value, directory } = await projection();
      const items = [...value.snapshot.people, ...value.tombstones.people].filter((p) =>
        p.active === (query.active === "true")
        && (!query.unitId || ("currentPrimaryUnitId" in p && p.currentPrimaryUnitId === query.unitId))
        && (p.displayName.toLocaleLowerCase().includes(query.q.toLocaleLowerCase()) || ("employeeNumber" in p && p.employeeNumber.toLocaleLowerCase().includes(query.q.toLocaleLowerCase()))));
      return { ...page(items, query, directory.version, "people"), directory };
    });
    routes.get("/people/by-identity", async (request) => {
      const identity = parse(z.object({ issuer: z.string().url().max(2048), subject: z.string().min(1).max(2048) }).strict(), request.query);
      const { value, directory } = await projection();
      const matches = value.snapshot.people.filter((p) => p.identityRefs.some((i) => i.issuer === identity.issuer && i.subject === identity.subject));
      if (matches.length > 1) throw new ReadError(409, "DIRECTORY_INTEGRITY_ERROR");
      return { item: found(matches[0]), directory };
    });
    routes.get("/people/:personId", async (request) => {
      const params = parse(z.object({ personId }).strict(), request.params);
      parse(z.object({}).strict(), request.query);
      const { value, directory } = await projection();
      return { item: found([...value.snapshot.people, ...value.tombstones.people].find((p) => p.id === params.personId)), directory };
    });
  }, { prefix: DIRECTORY_PREFIX });
}
