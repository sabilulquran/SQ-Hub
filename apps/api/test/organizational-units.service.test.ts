import { describe, expect, it } from "vitest";

import type { OrganizationalUnitRepository } from "../src/modules/organizational-units/repository.js";
import { OrganizationalUnitService } from "../src/modules/organizational-units/service.js";
import type { ApplyImportResult, OrganizationalUnit } from "../src/modules/organizational-units/types.js";

const actor = { kind: "human" as const, ref: "staff:safe-actor" };
const now = "2026-09-04T00:00:00.000Z";
const root: OrganizationalUnit = {
  id: "11111111-1111-4111-8111-111111111111",
  unitKey: "yayasan",
  name: "Yayasan",
  parentId: null,
  active: true,
  createdAt: now,
  updatedAt: now,
};
const child: OrganizationalUnit = {
  id: "22222222-2222-4222-8222-222222222222",
  unitKey: "pendidikan",
  name: "Pendidikan",
  parentId: root.id,
  active: true,
  createdAt: now,
  updatedAt: now,
};

function fixture(
  units: OrganizationalUnit[] = [root, child],
  initialMappings: Array<{ sourceRef: string; unit: OrganizationalUnit }> = [],
) {
  const state = units.map((unit) => ({ ...unit }));
  const mappings = new Map<string, OrganizationalUnit>(
    initialMappings.map((mapping) => [mapping.sourceRef, mapping.unit]),
  );
  const applied = new Map<string, ApplyImportResult>();
  const repo: OrganizationalUnitRepository = {
    list: async () => state,
    findById: async (id) => state.find((unit) => unit.id === id) ?? null,
    findByKeys: async (keys) => state.filter((unit) => keys.includes(unit.unitKey)),
    create: async (input) => {
      if (state.some((unit) => unit.unitKey === input.unitKey)) throw new Error("duplicate");
      const unit = {
        id: "33333333-3333-4333-8333-333333333333",
        unitKey: input.unitKey,
        name: input.name,
        parentId: input.parentId,
        active: input.active,
        createdAt: now,
        updatedAt: now,
      };
      state.push(unit);
      return unit;
    },
    update: async (input) => {
      const index = state.findIndex((unit) => unit.id === input.id);
      if (index < 0) throw new Error("missing");
      state[index] = {
        ...state[index]!,
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
      };
      return state[index]!;
    },
    setActive: async (input) => {
      const unit = state.find((candidate) => candidate.id === input.id)!;
      if (unit.active === input.active) return { outcome: "noop", unit };
      unit.active = input.active;
      return { outcome: "succeeded", unit };
    },
    findMappings: async (_sourceSystem, refs) => new Map(
      [...mappings].filter(([ref]) => refs.includes(ref)),
    ),
    findMappingSourcesByKeys: async (_sourceSystem, keys) => new Map(
      [...mappings.entries()]
        .filter(([, unit]) => keys.includes(unit.unitKey))
        .map(([sourceRef, unit]) => [unit.unitKey, sourceRef]),
    ),
    applyImport: async (input) => {
      const prior = applied.get(input.fingerprint);
      if (prior) return { ...prior, outcome: "noop" };
      const result: ApplyImportResult = {
        outcome: "succeeded",
        fingerprint: input.fingerprint,
        created: input.rows.length,
        updated: 0,
        unchanged: 0,
        deleted: 0,
      };
      applied.set(input.fingerprint, result);
      return result;
    },
  };
  return { service: new OrganizationalUnitService(repo), state };
}

describe("OrganizationalUnitService", () => {
  it("builds deterministic hierarchy and rejects a proposed cycle", async () => {
    const { service } = fixture([child, root]);
    const hierarchy = await service.hierarchy() as Array<{
      unitKey: string;
      children: Array<{ unitKey: string }>;
    }>;
    expect(hierarchy[0]?.unitKey).toBe("yayasan");
    expect(hierarchy[0]?.children[0]?.unitKey).toBe("pendidikan");
    await expect(
      service.update(root.id, { parentId: child.id, reason: "synthetic cycle" }, actor),
    ).rejects.toMatchObject({ code: "ORGANIZATIONAL_UNIT_INVALID" });
  });

  it("does not expose unitKey as a mutable field", async () => {
    const { service } = fixture();
    await expect(service.update(
      child.id,
      { unitKey: "renamed-key", name: "Renamed", reason: "attempt" },
      actor,
    )).rejects.toBeTruthy();
  });

  it("activates/deactivates idempotently", async () => {
    const { service } = fixture();
    const first = await service.setActive(
      child.id,
      { active: false, reason: "retire", confirm: true },
      actor,
    );
    expect(first.outcome).toBe("succeeded");
    const second = await service.setActive(
      child.id,
      { active: false, reason: "retry", confirm: true },
      actor,
    );
    expect(second.outcome).toBe("noop");
  });

  it("requires explicit mappings and rejects invalid HCIS hierarchy/mapping", async () => {
    const { service } = fixture([]);
    const invalid = await service.previewImport({
      sourceSystem: "hcis",
      rows: [{
        sourceRef: "A",
        name: "A",
        parentSourceRef: "MISSING",
        active: true,
      }],
      mappings: [],
    });
    expect(invalid.valid).toBe(false);
    expect(invalid.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["MISSING_PARENT_SOURCE", "MISSING_MAPPING"]),
    );
    expect(invalid.implicitDeletions).toBe(0);
  });

  it("never treats sourceRef as unitKey implicitly and produces stable fingerprint", async () => {
    const { service } = fixture([]);
    const input = {
      sourceSystem: "hcis" as const,
      rows: [{
        sourceRef: "550e8400-e29b-41d4-a716-446655440000",
        sourceCode: "UNIT-01",
        name: "Sekolah",
        parentSourceRef: null,
        active: true,
      }],
      mappings: [{
        sourceRef: "550e8400-e29b-41d4-a716-446655440000",
        unitKey: "sekolah",
      }],
    };
    const first = await service.previewImport(input);
    const second = await service.previewImport(input);
    expect(first.valid).toBe(true);
    expect(first.creates[0]?.unitKey).toBe("sekolah");
    expect(first.creates[0]?.unitKey).not.toBe(input.rows[0]!.sourceRef);
    expect(first.fingerprint).toBe(second.fingerprint);
    expect(first.implicitDeletions).toBe(0);
  });

  it("rejects remapping a stable unit key from a different HCIS source reference", async () => {
    const existingUnit: OrganizationalUnit = {
      ...root,
      unitKey: "sekolah",
      name: "Sekolah",
    };
    const { service } = fixture(
      [existingUnit],
      [{ sourceRef: "HCIS-OLD", unit: existingUnit }],
    );
    const preview = await service.previewImport({
      sourceSystem: "hcis",
      rows: [{
        sourceRef: "HCIS-NEW",
        name: "Sekolah",
        parentSourceRef: null,
        active: true,
      }],
      mappings: [{ sourceRef: "HCIS-NEW", unitKey: "sekolah" }],
    });
    expect(preview.valid).toBe(false);
    expect(preview.issues).toContainEqual(expect.objectContaining({
      code: "UNIT_KEY_MAPPING_CONFLICT",
      sourceRef: "HCIS-NEW",
      unitKey: "sekolah",
    }));
  });

  it("keeps repeated import apply idempotent", async () => {
    const { service } = fixture([]);
    const input = {
      sourceSystem: "hcis" as const,
      rows: [{
        sourceRef: "HCIS-1",
        name: "Sekolah",
        parentSourceRef: null,
        active: true,
      }],
      mappings: [{ sourceRef: "HCIS-1", unitKey: "sekolah" }],
      reason: "staging rehearsal",
      confirm: true as const,
    };
    const first = await service.applyImport(input, actor);
    const second = await service.applyImport(input, actor);
    expect(first.outcome).toBe("succeeded");
    expect(second.outcome).toBe("noop");
    expect(second.deleted).toBe(0);
  });
});
