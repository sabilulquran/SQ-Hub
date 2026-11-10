import type { Projection } from "../organization-directory/repository.js";

/**
 * KERJA-IMPL-001 §2 and §5: the module reads Organization Directory (HUB-IMPL-018) and never
 * touches HCIS or the directory tables. Names are display caches that may be stale (§7.3 nomor 1).
 */
export interface KerjaDirectorySource {
  read(): Promise<Projection | null>;
}

export interface DirectoryPerson {
  id: string;
  nama: string;
  nip: string;
  aktif: boolean;
  unitId: string | null;
  identities: Array<{ issuer: string; subject: string }>;
}

export interface DirectoryUnit {
  id: string;
  nama: string;
  jenis: string;
  indukId: string | null;
  aktif: boolean;
}

export interface DirectoryView {
  version: string;
  stale: boolean;
  people: Map<string, DirectoryPerson>;
  units: Map<string, DirectoryUnit>;
  personByIdentity(identity: { issuer: string; subject: string }): DirectoryPerson | null;
  ancestry(unitId: string): DirectoryUnit[];
}

/** Same freshness rule as HUB-IMPL-018 §11 (`directoryMetadata`): stale after 15 minutes. */
const STALE_AFTER_MS = 900_000;
const CACHE_MS = 30_000;

export class KerjaDirectory {
  private cache: { at: number; view: DirectoryView } | null = null;

  constructor(
    private readonly source: KerjaDirectorySource,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Null when the Directory has never been synchronized: callers fail closed with 503. */
  async view(): Promise<DirectoryView | null> {
    const nowMs = this.now().getTime();
    if (this.cache && nowMs - this.cache.at < CACHE_MS) return this.cache.view;
    const projection = await this.source.read();
    if (!projection) return null;
    const view = buildView(projection, nowMs);
    this.cache = { at: nowMs, view };
    return view;
  }

  invalidate(): void {
    this.cache = null;
  }
}

function buildView(projection: Projection, nowMs: number): DirectoryView {
  const asOf = projection.snapshot.asOf;
  const units = new Map<string, DirectoryUnit>();
  for (const unit of projection.snapshot.units) {
    const effective = unit.effectiveFrom <= asOf && (!unit.effectiveTo || unit.effectiveTo >= asOf);
    units.set(unit.id, { id: unit.id, nama: unit.name, jenis: unit.nodeType, indukId: unit.parentUnitId, aktif: unit.active && effective });
  }
  for (const unit of projection.tombstones.units) {
    if (!units.has(unit.id)) units.set(unit.id, { id: unit.id, nama: unit.name, jenis: "", indukId: null, aktif: false });
  }
  const people = new Map<string, DirectoryPerson>();
  const byIdentity = new Map<string, DirectoryPerson>();
  for (const person of projection.snapshot.people) {
    const entry: DirectoryPerson = {
      id: person.id,
      nama: person.displayName,
      nip: person.employeeNumber,
      aktif: person.active,
      unitId: person.currentPrimaryUnitId,
      identities: person.identityRefs.map((ref) => ({ issuer: ref.issuer, subject: ref.subject })),
    };
    people.set(person.id, entry);
    for (const ref of entry.identities) byIdentity.set(identityKey(ref), entry);
  }
  for (const person of projection.tombstones.people) {
    if (!people.has(person.id)) {
      people.set(person.id, { id: person.id, nama: person.displayName, nip: "", aktif: false, unitId: null, identities: [] });
    }
  }
  const stale = nowMs - Date.parse(projection.synchronizedAt) >= STALE_AFTER_MS;
  return {
    version: projection.snapshot.version,
    stale,
    people,
    units,
    personByIdentity(identity) {
      return byIdentity.get(identityKey(identity)) ?? null;
    },
    ancestry(unitId) {
      const chain: DirectoryUnit[] = [];
      const seen = new Set<string>();
      let id: string | null = unitId;
      while (id && !seen.has(id)) {
        seen.add(id);
        const unit = units.get(id);
        if (!unit) break;
        chain.push(unit);
        id = unit.indukId;
      }
      return chain;
    },
  };
}

function identityKey(identity: { issuer: string; subject: string }): string {
  return `${identity.issuer.replace(/\/$/, "")}\n${identity.subject}`;
}
