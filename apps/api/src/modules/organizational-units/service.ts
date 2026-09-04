import { createHash } from "node:crypto";

import { z } from "zod";

import type { ActorRef } from "../application-access/types.js";
import type { OrganizationalUnitRepository } from "./repository.js";
import type {
  ImportIssue,
  ImportMapping,
  ImportPreview,
  ImportSnapshotRow,
  OrganizationalUnit,
} from "./types.js";

const actorSchema = z.object({
  kind: z.enum(["human", "service", "system"]),
  ref: z.string().trim().min(1).max(512),
}).strict();
const idSchema = z.string().uuid();
const keySchema = z.string().trim().min(1).max(63).regex(/^[a-z0-9][a-z0-9-]{0,62}$/);
const reasonSchema = z.string().trim().min(1).max(1000);
const nameSchema = z.string().trim().min(1).max(255);

export const createUnitSchema = z.object({
  unitKey: keySchema,
  name: nameSchema,
  parentId: idSchema.nullable().default(null),
  active: z.boolean().default(true),
  reason: reasonSchema,
}).strict();

export const updateUnitSchema = z.object({
  name: nameSchema.optional(),
  parentId: idSchema.nullable().optional(),
  reason: reasonSchema,
}).strict().refine(
  (value) => value.name !== undefined || value.parentId !== undefined,
  "at least one mutable field is required",
);

export const unitStatusSchema = z.object({
  active: z.boolean(),
  reason: reasonSchema,
  confirm: z.literal(true),
}).strict();

const snapshotRowSchema = z.object({
  sourceRef: z.string().trim().min(1).max(255),
  sourceCode: z.string().trim().min(1).max(255).nullable().optional().default(null),
  name: nameSchema,
  parentSourceRef: z.string().trim().min(1).max(255).nullable().optional().default(null),
  active: z.boolean().default(true),
}).strict();
const mappingSchema = z.object({
  sourceRef: z.string().trim().min(1).max(255),
  unitKey: keySchema,
}).strict();
export const inspectImportSchema = z.object({
  sourceSystem: z.literal("hcis"),
  rows: z.array(snapshotRowSchema).max(5000),
}).strict();
export const previewImportSchema = z.object({
  sourceSystem: z.literal("hcis"),
  rows: z.array(snapshotRowSchema).max(5000),
  mappings: z.array(mappingSchema).max(5000),
}).strict();
export const applyImportSchema = previewImportSchema.extend({
  reason: reasonSchema,
  confirm: z.literal(true),
}).strict();

export class OrganizationalUnitValidationError extends Error {
  readonly code = "ORGANIZATIONAL_UNIT_INVALID";

  constructor(public readonly issues: ImportIssue[]) {
    super("Organizational Unit validation failed");
  }
}

export class OrganizationalUnitService {
  constructor(private readonly repository: OrganizationalUnitRepository) {}

  async list() {
    return this.repository.list();
  }

  async hierarchy() {
    return buildHierarchy(await this.repository.list());
  }

  async create(input: unknown, actor: ActorRef) {
    actorSchema.parse(actor);
    const parsed = createUnitSchema.parse(input);
    if (parsed.parentId) await this.requireUnit(parsed.parentId);
    return this.repository.create({ ...parsed, actor });
  }

  async update(id: string, input: unknown, actor: ActorRef) {
    actorSchema.parse(actor);
    const safeId = idSchema.parse(id);
    const parsed = updateUnitSchema.parse(input);
    await this.requireUnit(safeId);
    if (parsed.parentId === safeId) {
      throw new OrganizationalUnitValidationError([
        { code: "SELF_PARENT", message: "Unit cannot be its own parent." },
      ]);
    }
    if (parsed.parentId) {
      await this.requireUnit(parsed.parentId);
      if (wouldCreateCycle(await this.repository.list(), safeId, parsed.parentId)) {
        throw new OrganizationalUnitValidationError([
          { code: "HIERARCHY_CYCLE", message: "Parent change would create a hierarchy cycle." },
        ]);
      }
    }
    return this.repository.update({
      id: safeId,
      ...(parsed.name !== undefined ? { name: parsed.name } : {}),
      ...(parsed.parentId !== undefined ? { parentId: parsed.parentId } : {}),
      actor,
      reason: parsed.reason,
    });
  }

  async setActive(id: string, input: unknown, actor: ActorRef) {
    actorSchema.parse(actor);
    const safeId = idSchema.parse(id);
    const parsed = unitStatusSchema.parse(input);
    await this.requireUnit(safeId);
    return this.repository.setActive({
      id: safeId,
      active: parsed.active,
      actor,
      reason: parsed.reason,
    });
  }

  inspectImport(input: unknown) {
    const parsed = inspectImportSchema.parse(input);
    const issues = validateSnapshot(parsed.rows);
    return {
      sourceSystem: parsed.sourceSystem,
      ownershipState: "PRE_CUTOVER" as const,
      rowCount: parsed.rows.length,
      rootCount: parsed.rows.filter((row) => row.parentSourceRef === null).length,
      activeCount: parsed.rows.filter((row) => row.active).length,
      issues,
      valid: issues.length === 0,
      snapshot: parsed.rows.map((row) => ({
        sourceRef: row.sourceRef,
        sourceCode: row.sourceCode,
        name: row.name,
        parentSourceRef: row.parentSourceRef,
        active: row.active,
      })),
    };
  }

  async previewImport(input: unknown): Promise<ImportPreview> {
    const parsed = previewImportSchema.parse(input);
    const rows = parsed.rows as ImportSnapshotRow[];
    const mappings = parsed.mappings as ImportMapping[];
    const issues = [...validateSnapshot(rows), ...validateMappings(rows, mappings)];
    const mappingByRef = new Map(
      mappings.map((mapping) => [mapping.sourceRef, mapping.unitKey]),
    );
    const unitKeys = [...new Set(mappings.map((mapping) => mapping.unitKey))];
    const existingByKey = new Map(
      (await this.repository.findByKeys(unitKeys)).map((unit) => [unit.unitKey, unit]),
    );
    const existingMappings = await this.repository.findMappings(
      parsed.sourceSystem,
      rows.map((row) => row.sourceRef),
    );
    const existingSourceByKey = await this.repository.findMappingSourcesByKeys(
      parsed.sourceSystem,
      unitKeys,
    );

    for (const mapping of mappings) {
      const existingMapped = existingMappings.get(mapping.sourceRef);
      if (existingMapped && existingMapped.unitKey !== mapping.unitKey) {
        issues.push({
          code: "SOURCE_MAPPING_CONFLICT",
          sourceRef: mapping.sourceRef,
          unitKey: mapping.unitKey,
          message: `Source reference is already mapped to ${existingMapped.unitKey}.`,
        });
      }
      const existingSource = existingSourceByKey.get(mapping.unitKey);
      if (existingSource && existingSource !== mapping.sourceRef) {
        issues.push({
          code: "UNIT_KEY_MAPPING_CONFLICT",
          sourceRef: mapping.sourceRef,
          unitKey: mapping.unitKey,
          message: `Unit key is already mapped from source reference ${existingSource}.`,
        });
      }
    }

    const creates: ImportPreview["creates"] = [];
    const updates: ImportPreview["updates"] = [];
    const unchanged: ImportPreview["unchanged"] = [];
    if (issues.length === 0) {
      for (const row of rows) {
        const unitKey = mappingByRef.get(row.sourceRef)!;
        const existing = existingMappings.get(row.sourceRef) ?? existingByKey.get(unitKey);
        if (!existing) {
          creates.push({ sourceRef: row.sourceRef, unitKey, name: row.name });
        } else if (
          existing.name !== row.name ||
          existing.active !== row.active ||
          parentKey(existing, existingByKey) !== (
            row.parentSourceRef
              ? mappingByRef.get(row.parentSourceRef) ?? null
              : null
          )
        ) {
          updates.push({ sourceRef: row.sourceRef, unitKey, name: row.name });
        } else {
          unchanged.push({ sourceRef: row.sourceRef, unitKey });
        }
      }
    }

    return {
      sourceSystem: parsed.sourceSystem,
      fingerprint: fingerprint(rows, mappings),
      ownershipState: "PRE_CUTOVER",
      valid: issues.length === 0,
      creates,
      updates,
      unchanged,
      issues: dedupeIssues(issues),
      implicitDeletions: 0,
    };
  }

  async applyImport(input: unknown, actor: ActorRef) {
    actorSchema.parse(actor);
    const parsed = applyImportSchema.parse(input);
    const preview = await this.previewImport(parsed);
    if (!preview.valid) throw new OrganizationalUnitValidationError(preview.issues);
    return this.repository.applyImport({
      sourceSystem: parsed.sourceSystem,
      fingerprint: preview.fingerprint,
      rows: parsed.rows as ImportSnapshotRow[],
      mappings: parsed.mappings as ImportMapping[],
      actor,
      reason: parsed.reason,
    });
  }

  private async requireUnit(id: string) {
    const unit = await this.repository.findById(id);
    if (!unit) {
      const error = new Error("ORGANIZATIONAL_UNIT_NOT_FOUND");
      error.name = "OrganizationalUnitNotFoundError";
      throw error;
    }
    return unit;
  }
}

export function buildHierarchy(units: OrganizationalUnit[]) {
  const children = new Map<string | null, OrganizationalUnit[]>();
  for (const unit of units) {
    const list = children.get(unit.parentId) ?? [];
    list.push(unit);
    children.set(unit.parentId, list);
  }
  for (const list of children.values()) {
    list.sort((a, b) => a.unitKey.localeCompare(b.unitKey));
  }
  const visit = (unit: OrganizationalUnit, path: Set<string>): unknown => {
    if (path.has(unit.id)) {
      throw new OrganizationalUnitValidationError([
        { code: "HIERARCHY_CYCLE", message: "Stored hierarchy contains a cycle." },
      ]);
    }
    const next = new Set(path);
    next.add(unit.id);
    return {
      ...unit,
      children: (children.get(unit.id) ?? []).map((child) => visit(child, next)),
    };
  };
  return (children.get(null) ?? []).map((root) => visit(root, new Set()));
}

function validateSnapshot(rows: ImportSnapshotRow[]): ImportIssue[] {
  const issues: ImportIssue[] = [];
  const refs = new Set<string>();
  for (const row of rows) {
    if (refs.has(row.sourceRef)) {
      issues.push({
        code: "DUPLICATE_SOURCE_REF",
        sourceRef: row.sourceRef,
        message: "Duplicate source reference.",
      });
    }
    refs.add(row.sourceRef);
    if (row.parentSourceRef === row.sourceRef) {
      issues.push({
        code: "SELF_PARENT",
        sourceRef: row.sourceRef,
        message: "Source row cannot parent itself.",
      });
    }
  }
  for (const row of rows) {
    if (row.parentSourceRef && !refs.has(row.parentSourceRef)) {
      issues.push({
        code: "MISSING_PARENT_SOURCE",
        sourceRef: row.sourceRef,
        message: `Parent source reference ${row.parentSourceRef} is missing.`,
      });
    }
  }
  if (!issues.some((issue) =>
    issue.code === "DUPLICATE_SOURCE_REF" || issue.code === "MISSING_PARENT_SOURCE"
  )) {
    const parent = new Map(rows.map((row) => [row.sourceRef, row.parentSourceRef]));
    for (const row of rows) {
      const seen = new Set<string>();
      let cursor: string | null = row.sourceRef;
      while (cursor) {
        if (seen.has(cursor)) {
          issues.push({
            code: "HIERARCHY_CYCLE",
            sourceRef: row.sourceRef,
            message: "Source hierarchy contains a cycle.",
          });
          break;
        }
        seen.add(cursor);
        cursor = parent.get(cursor) ?? null;
      }
    }
  }
  return dedupeIssues(issues);
}

function validateMappings(
  rows: ImportSnapshotRow[],
  mappings: ImportMapping[],
): ImportIssue[] {
  const issues: ImportIssue[] = [];
  const rowRefs = new Set(rows.map((row) => row.sourceRef));
  const mappedRefs = new Set<string>();
  const keys = new Set<string>();
  for (const mapping of mappings) {
    if (!rowRefs.has(mapping.sourceRef)) {
      issues.push({
        code: "UNKNOWN_MAPPING_SOURCE",
        sourceRef: mapping.sourceRef,
        unitKey: mapping.unitKey,
        message: "Mapping source is absent from snapshot.",
      });
    }
    if (mappedRefs.has(mapping.sourceRef)) {
      issues.push({
        code: "DUPLICATE_MAPPING_SOURCE",
        sourceRef: mapping.sourceRef,
        message: "Source reference has multiple mappings.",
      });
    }
    if (keys.has(mapping.unitKey)) {
      issues.push({
        code: "DUPLICATE_UNIT_KEY",
        sourceRef: mapping.sourceRef,
        unitKey: mapping.unitKey,
        message: "One unit key cannot map multiple source rows.",
      });
    }
    mappedRefs.add(mapping.sourceRef);
    keys.add(mapping.unitKey);
  }
  for (const row of rows) {
    if (!mappedRefs.has(row.sourceRef)) {
      issues.push({
        code: "MISSING_MAPPING",
        sourceRef: row.sourceRef,
        message: "Every source row requires an explicit SQ Hub unit key mapping.",
      });
    }
  }
  return issues;
}

function wouldCreateCycle(
  units: OrganizationalUnit[],
  unitId: string,
  proposedParentId: string,
) {
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  let cursor: string | null = proposedParentId;
  const seen = new Set<string>();
  while (cursor) {
    if (cursor === unitId) return true;
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    cursor = byId.get(cursor)?.parentId ?? null;
  }
  return false;
}

function parentKey(
  unit: OrganizationalUnit,
  existingByKey: Map<string, OrganizationalUnit>,
) {
  if (!unit.parentId) return null;
  for (const candidate of existingByKey.values()) {
    if (candidate.id === unit.parentId) return candidate.unitKey;
  }
  return null;
}

function fingerprint(rows: ImportSnapshotRow[], mappings: ImportMapping[]) {
  const normalized = {
    rows: [...rows].sort((a, b) => a.sourceRef.localeCompare(b.sourceRef)),
    mappings: [...mappings].sort((a, b) => a.sourceRef.localeCompare(b.sourceRef)),
  };
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

function dedupeIssues(issues: ImportIssue[]) {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.code}:${issue.sourceRef ?? ""}:${issue.unitKey ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
