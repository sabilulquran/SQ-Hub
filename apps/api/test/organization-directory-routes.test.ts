import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildApp } from "../src/app.js";
import { MachineAuthError } from "../src/modules/application-access/machine-auth.js";
import type { Projection } from "../src/modules/organization-directory/repository.js";
import { DIRECTORY_PREFIX as base } from "../src/modules/organization-directory/routes.js";
import { fixture } from "./organization-directory.fixture.js";

let now = new Date("2026-09-24T01:30:00Z");
let projection: Projection | null;
let reads = 0;
const apps: ReturnType<typeof buildApp>[] = [];
function setup() {
  reads = 0;
  now = new Date("2026-09-24T01:30:00Z");
  projection = { snapshot: fixture(), tombstones: { units: [], positions: [], people: [] }, synchronizedAt: now.toISOString() };
  const app = buildApp({
    accessService: { checkAccess: async () => { throw new Error("must not couple directory to Application Access"); } },
    verifyMachineToken: async () => { throw new Error("must use directory verifier"); },
    organizationDirectory: {
      read: async () => { reads++; return projection; }, now: () => now,
      verifyMachineToken: async (token) => {
        if (token === "synthetic-directory-token") return { clientId: "aset-sq-directory" };
        throw new MachineAuthError(token === "forbidden" ? "FORBIDDEN_CLIENT" : "INVALID_TOKEN", "synthetic");
      },
    },
  });
  apps.push(app);
  return { app, get: (path: string) => app.inject({ url: base + path, headers: { authorization: "Bearer synthetic-directory-token" } }) };
}
afterEach(async () => { await Promise.all(apps.splice(0).map((a) => a.close())); });

describe("Organization Directory machine read contract", () => {
  it("redacts actual request logs including search text, identifiers and bearer headers", () => {
    const output = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
      import { buildApp } from './src/app.ts';
      const app = buildApp({ logger: true,
        accessService: { checkAccess: async () => ({}) }, verifyMachineToken: async () => ({}),
        organizationDirectory: { read: async () => null, verifyMachineToken: async () => ({ clientId: 'reader' }) }
      });
      for (const path of ['/people?q=private-name-sentinel', '/people/by-identity?issuer=https://example.test&subject=private-subject-sentinel', '/people/hcis:employee:00000000-0000-4000-8000-000000000115']) {
        await app.inject({ url: '/internal/v1/organization-directory' + path, headers: { authorization: 'Bearer private-token-sentinel' } });
      }
      await app.close();
    `], { cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8" });
    expect(output).toContain(base);
    expect(output).not.toMatch(/private-name-sentinel|private-subject-sentinel|private-token-sentinel|000000000115/);
  });
  it("authenticates every route before accessing projection, ignores browser cookies", async () => {
    const { app } = setup();
    const paths = ["/units", `/units/${fixture().units[0]!.id}`, `/units/${fixture().units[0]!.id}/ancestry`, "/people", `/people/${fixture().people[0]!.id}`, "/people/by-identity?issuer=https://example.test&subject=test"];
    for (const path of paths) {
      for (const [headers, status, error] of [
        [{ cookie: "hub-session=synthetic" }, 401, "UNAUTHENTICATED"],
        [{ authorization: "Bearer invalid" }, 401, "UNAUTHENTICATED"],
        [{ authorization: "Bearer forbidden" }, 403, "FORBIDDEN_CLIENT"],
      ] as const) {
        const response = await app.inject({ url: base + path, headers });
        expect(response.statusCode).toBe(status);
        expect(response.json()).toEqual({ error });
      }
    }
    expect(reads).toBe(0);
  });
  it("returns 503 with no LKG, serves stale LKG at the exact 15-minute boundary", async () => {
    const { get } = setup();
    now = new Date("2026-09-24T01:44:59.999Z");
    expect((await get("/units")).json().directory.stale).toBe(false);
    now = new Date("2026-09-24T01:45:00Z");
    const stale = await get("/people");
    expect(stale.statusCode).toBe(200);
    expect(stale.headers["cache-control"]).toBe("no-store");
    expect(stale.json().directory).toMatchObject({ stale: true, staleForSeconds: 0, synchronizedAt: "2026-09-24T01:30:00.000Z", asOf: "2026-09-24", version: fixture().version });
    now = new Date("2026-09-24T01:46:30Z");
    expect((await get("/units")).json().directory.staleForSeconds).toBe(90);
    projection = null;
    expect((await get("/units")).statusCode).toBe(503);
    expect((await get("/people")).json()).toEqual({ error: "DIRECTORY_UNAVAILABLE" });
  });
  it("searches name/NIP and unit without returning excluded personal fields", async () => {
    const { get } = setup();
    expect((await get("/people?q=demo-001")).json().items).toHaveLength(1);
    expect((await get("/people?q=pegawai&active=false")).json().items[0].id).toBe(fixture().people[1]!.id);
    expect((await get(`/people?unitId=${fixture().units[1]!.id}`)).json().items).toHaveLength(1);
    expect((await get(`/people?unitId=${fixture().units[0]!.id}`)).json().items).toHaveLength(0);
    expect((await get("/people")).body).not.toMatch(/email|phone|nik|payroll/);
  });
  it("uses exact opaque issuer+subject and returns inactive people without guessing", async () => {
    const { get } = setup();
    const identity = fixture().people[0]!.identityRefs[0]!;
    projection!.snapshot.people[0]!.active = false;
    const query = new URLSearchParams(identity);
    const response = await get(`/people/by-identity?${query}`);
    expect(response.statusCode).toBe(200);
    expect(response.json().item.active).toBe(false);
    expect(response.json().item.id).toBe(fixture().people[0]!.id);
    query.set("issuer", "https://different.example.test/realms/demo");
    expect((await get(`/people/by-identity?${query}`)).statusCode).toBe(404);
    query.set("issuer", identity.issuer); query.set("subject", "DEMO-001");
    expect((await get(`/people/by-identity?${query}`)).statusCode).toBe(404);
    expect((await get("/people/by-identity?subject=x")).statusCode).toBe(400);
  });
  it("preserves inclusive unit periods while excluding expired rows from active search", async () => {
    const { get } = setup();
    projection!.snapshot.units[1]!.effectiveTo = "2026-09-24";
    expect((await get("/units")).json().items).toHaveLength(2);
    projection!.snapshot.units[1]!.effectiveTo = "2026-09-23";
    expect((await get("/units")).json().items).toHaveLength(1);
    expect((await get("/units?active=false")).json().items).toHaveLength(1);
  });
  it("returns ancestry requested-to-root; rejects cycles and missing parents", async () => {
    const { get } = setup();
    const child = fixture().units[1]!.id;
    const root = fixture().units[0]!.id;
    expect((await get(`/units/${child}/ancestry`)).json().items.map((u: { id: string }) => u.id)).toEqual([child, root]);
    projection!.snapshot.units[0]!.parentUnitId = child;
    expect((await get(`/units/${child}/ancestry`)).statusCode).toBe(409);
    projection!.snapshot.units.shift();
    expect((await get(`/units/${child}/ancestry`)).json()).toEqual({ error: "DIRECTORY_INTEGRITY_ERROR" });
  });
  it("paginates with version/filter-bound cursors and validates query inputs", async () => {
    const { get } = setup();
    const first = (await get("/units?limit=1")).json();
    expect(first.items).toHaveLength(1);
    const second = (await get(`/units?limit=1&cursor=${first.nextCursor}`)).json();
    expect(second.items[0].id).not.toBe(first.items[0].id);
    expect(second.nextCursor).toBeNull();
    expect((await get(`/units?limit=1&q=changed&cursor=${first.nextCursor}`)).statusCode).toBe(400);
    projection!.snapshot.version = `sha256:${"0".repeat(64)}`;
    expect((await get(`/units?limit=1&cursor=${first.nextCursor}`)).statusCode).toBe(400);
    for (const query of ["limit=0", "limit=101", "active=yes", "extra=unexpected", "cursor=malformed"]) {
      expect((await get(`/units?${query}`)).statusCode).toBe(400);
    }
  });
  it("returns minimal tombstones by id and inactive search, but never invents ancestry/identity", async () => {
    const { get } = setup();
    const unit = projection!.snapshot.units.pop()!;
    const person = projection!.snapshot.people.shift()!;
    projection!.tombstones.units.push({ id: unit.id, name: unit.name, active: false, sourceAbsent: true });
    projection!.tombstones.people.push({ id: person.id, displayName: person.displayName, active: false, sourceAbsent: true });
    expect((await get(`/units/${unit.id}`)).json().item.sourceAbsent).toBe(true);
    expect((await get(`/people/${person.id}`)).json().item.sourceAbsent).toBe(true);
    expect((await get(`/units/${unit.id}/ancestry`)).statusCode).toBe(409);
    expect((await get("/people?active=false")).json().items).toHaveLength(2);
    expect((await get(`/people/by-identity?${new URLSearchParams(person.identityRefs[0]!)}`)).statusCode).toBe(404);
  });
});
