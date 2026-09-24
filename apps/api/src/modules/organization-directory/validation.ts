import { createHash } from "node:crypto";
import { z } from "zod";
import { organizationDirectorySnapshotSchema, type OrganizationDirectorySnapshot as Snapshot } from "./contract.js";

export class DirectorySyncError extends Error {
  constructor(public readonly category: "contract_validation" | "source_regression" | "source_auth" | "source_request" | "source_unavailable" | "storage") {
    super(category);
  }
}

export const businessDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});

export function jakartaBusinessDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

// HCIS #86 f66fe859: JSON.stringify(versionInput), in this exact field order.
// Parse first to restore field order even after JSONB reorders object keys.
export function contentVersion(input: Snapshot): string {
  const s = organizationDirectorySnapshotSchema.parse(input);
  return `sha256:${createHash("sha256").update(JSON.stringify({
    schemaVersion: s.schemaVersion, source: s.source, asOf: s.asOf,
    counts: s.counts, units: s.units, positions: s.positions, people: s.people,
  }), "utf8").digest("hex")}`;
}

function assert(condition: unknown): asserts condition {
  if (!condition) throw new DirectorySyncError("contract_validation");
}

function validateTree<T extends { id: string }>(rows: T[], parent: (row: T) => string | null) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const complete = new Set<string>();
  for (const row of rows) {
    const path = new Set<string>();
    let id: string | null = row.id;
    while (id !== null && !complete.has(id)) {
      assert(!path.has(id));
      path.add(id);
      const item = byId.get(id);
      assert(item);
      id = parent(item);
    }
    for (const id of path) complete.add(id);
  }
}

export function validateSnapshot(value: unknown, expectedAsOf: string): Snapshot {
  const parsed = organizationDirectorySnapshotSchema.safeParse(value);
  assert(parsed.success);
  const s = parsed.data;
  assert(s.asOf === expectedAsOf && businessDateSchema.safeParse(s.asOf).success);
  assert(businessDateSchema.safeParse(s.source.effectiveOn).success && s.source.effectiveOn <= s.asOf);
  for (const kind of ["units", "positions", "people"] as const) {
    assert(s[kind].length === s.counts[kind]);
    assert(new Set(s[kind].map((row) => row.id)).size === s[kind].length);
    for (const row of s[kind]) assert(z.string().uuid().safeParse(row.id.split(":")[2]).success);
  }
  for (const row of [...s.units, ...s.positions]) {
    assert(businessDateSchema.safeParse(row.effectiveFrom).success && row.effectiveFrom <= s.asOf);
    assert(row.effectiveTo === null || (businessDateSchema.safeParse(row.effectiveTo).success && row.effectiveTo >= row.effectiveFrom));
  }
  validateTree(s.units, (row) => row.parentUnitId);
  validateTree(s.positions, (row) => row.parentPositionId);
  const units = new Set(s.units.map((row) => row.id));
  const positions = new Set(s.positions.map((row) => row.id));
  for (const row of s.positions) assert(units.has(row.unitId));
  const identities = new Set<string>();
  for (const row of s.people) {
    assert(row.startedOn === null || businessDateSchema.safeParse(row.startedOn).success);
    assert(row.endedOn === null || businessDateSchema.safeParse(row.endedOn).success);
    assert(!row.startedOn || !row.endedOn || row.startedOn <= row.endedOn);
    assert(row.currentPrimaryUnitId === null || units.has(row.currentPrimaryUnitId));
    assert(new Set(row.structuralPositionIds).size === row.structuralPositionIds.length);
    for (const id of row.structuralPositionIds) assert(positions.has(id));
    assert(row.primaryStructuralPositionId === null || row.structuralPositionIds.includes(row.primaryStructuralPositionId));
    for (const identity of row.identityRefs) {
      const key = JSON.stringify([identity.issuer, identity.subject]);
      assert(!identities.has(key));
      identities.add(key);
    }
  }
  assert(contentVersion(s) === s.version);
  return s;
}

// UUID is only the final tie-breaker of HCIS's revision tuple, never a delta cursor.
export function assertNoRegression(next: Snapshot, previous: Snapshot) {
  if (next.asOf < previous.asOf) throw new DirectorySyncError("source_regression");
  const a = [next.source.effectiveOn, Date.parse(next.source.publishedAt), Date.parse(next.source.createdAt), next.source.snapshotId];
  const b = [previous.source.effectiveOn, Date.parse(previous.source.publishedAt), Date.parse(previous.source.createdAt), previous.source.snapshotId];
  for (let i = 0; i < a.length; i++) {
    if (a[i]! > b[i]!) return;
    if (a[i]! < b[i]!) throw new DirectorySyncError("source_regression");
  }
}
