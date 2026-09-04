import type { ActorRef } from "../application-access/types.js";

export interface OrganizationalUnit {
  id: string;
  unitKey: string;
  name: string;
  parentId: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ImportSnapshotRow {
  sourceRef: string;
  sourceCode: string | null;
  name: string;
  parentSourceRef: string | null;
  active: boolean;
}

export interface ImportMapping {
  sourceRef: string;
  unitKey: string;
}

export interface ImportIssue {
  code: string;
  sourceRef?: string;
  unitKey?: string;
  message: string;
}

export interface ImportPreview {
  sourceSystem: "hcis";
  fingerprint: string;
  ownershipState: "PRE_CUTOVER";
  valid: boolean;
  creates: Array<{ sourceRef: string; unitKey: string; name: string }>;
  updates: Array<{ sourceRef: string; unitKey: string; name: string }>;
  unchanged: Array<{ sourceRef: string; unitKey: string }>;
  issues: ImportIssue[];
  implicitDeletions: 0;
}

export interface ApplyImportResult {
  outcome: "succeeded" | "noop";
  fingerprint: string;
  created: number;
  updated: number;
  unchanged: number;
  deleted: 0;
}

export interface UnitMutationInput {
  actor: ActorRef;
  reason: string;
}
