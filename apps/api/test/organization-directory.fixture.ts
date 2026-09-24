import { readFileSync } from "node:fs";
import type { OrganizationDirectorySnapshot } from "../src/modules/organization-directory/contract.js";
import { contentVersion } from "../src/modules/organization-directory/validation.js";

export function fixture(): OrganizationDirectorySnapshot {
  return JSON.parse(readFileSync(new URL("./fixtures/hcis-organization-directory-v1.json", import.meta.url), "utf8"));
}
export function changed(edit: (s: OrganizationDirectorySnapshot) => void): OrganizationDirectorySnapshot {
  const s = fixture(); edit(s);
  s.counts = { units: s.units.length, positions: s.positions.length, people: s.people.length };
  s.version = contentVersion(s);
  return s;
}
