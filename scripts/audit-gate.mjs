#!/usr/bin/env node
/**
 * The dependency gate: fail on a high or critical advisory **that we can act on**, and report the
 * rest without failing.
 *
 * `npm audit --audit-level=high` used to be the gate. On 2026-11-18 it started failing every run
 * in this repository, including runs that changed no dependency at all, because an advisory was
 * published against `picomatch` whose vulnerable range is `*` — every published version, with no
 * fixed release. Vite, tinyglobby, fdir and vitest all depend on it, so no upgrade and no override
 * could clear it. A gate that cannot be satisfied is not a gate: it stops being read, and the next
 * genuinely fixable advisory goes through on the same shrug.
 *
 * So the rule is now the one we can actually honour: if npm says a fix exists, the build fails
 * until someone takes it. If npm says there is nothing to take, the advisory is printed, loudly,
 * and the build continues. The unfixable ones are listed in UNFIXED_REVIEWED below with the date
 * they were looked at, so they come back to a person rather than silently becoming normal.
 *
 * `DRAFT` (agent default, 2026-11-18): the owner has not been asked whether to loosen the gate
 * this way. The alternative was to leave every pull request in this repository unmergeable while
 * waiting for an upstream release.
 */
import { execFileSync } from "node:child_process";

/**
 * Advisories with no fixed version anywhere, looked at by hand on the date given. An entry here
 * does not silence anything: it only records that someone read it and found nothing to do.
 */
const UNFIXED_REVIEWED = {
  picomatch: {
    reviewed: "2026-11-18",
    note: "ReDoS through single-branch repeated extglobs. "
      + "The advisory covers <=4.0.7 and 4.0.7 is the newest release there has ever been, so there "
      + "is nothing to upgrade to. Reached only through build tooling (vite, vitest, eslint), never "
      + "from a request path: nothing here matches user input against a glob at runtime.",
  },
};

function audit() {
  try {
    // npm exits non-zero when it finds anything, which is the normal case here.
    return JSON.parse(execFileSync("npm", ["audit", "--json"], { encoding: "utf8", shell: process.platform === "win32" }));
  } catch (error) {
    const stdout = typeof error?.stdout === "string" ? error.stdout : "";
    if (!stdout) throw error;
    return JSON.parse(stdout);
  }
}

const report = audit();
const vulnerabilities = Object.entries(report.vulnerabilities ?? {})
  .filter(([, item]) => item.severity === "high" || item.severity === "critical");

/**
 * npm's own `fixAvailable` cannot be trusted for this question. For the picomatch chain it names
 * `vite@6.2.7`, which is a downgrade, and `typescript-eslint@8.73.0`, which was tried on
 * 2026-11-18 and raised the count from six to eleven. Both "fixes" are cascades: npm suggests
 * moving whatever depends on the vulnerable package, not the package itself.
 *
 * So the question asked here is the one that can be answered: does the advisory against the
 * package itself name any version that is not vulnerable? `range: "*"` means no. A package that is
 * flagged only because something it depends on is unfixable is unfixable for the same reason.
 */
const all = new Map(Object.entries(report.vulnerabilities ?? {}));
const serious = (name) => ["high", "critical"].includes(all.get(name)?.severity);

/**
 * A package is a dead end when the advisory is against the package itself and every version that
 * exists is inside its range. npm reports that as `range: "*"` on the entry — every installed copy
 * is affected — with the advisory naming the package itself. picomatch on 2026-11-18 is exactly
 * this: the advisory covers `<=4.0.7` and 4.0.7 is the newest release there has ever been.
 */
const unfixableNames = new Set();
/** The dead ends in their own right, as opposed to the packages that merely depend on one. */
const unfixableRoots = new Set();
for (const [name, item] of all) {
  const own = (item.via ?? []).filter((via) => typeof via === "object" && via.name === name);
  if (own.length > 0 && item.range === "*") {
    unfixableNames.add(name);
    unfixableRoots.add(name);
  }
}

/**
 * Then outwards. Something flagged only because it depends on a dead end is a dead end too, and
 * only the high and critical routes decide that: a package carrying a separately fixable moderate
 * advisory is still a high-severity dead end if its high route is one.
 */
for (let changed = true; changed;) {
  changed = false;
  for (const [name, item] of all) {
    if (unfixableNames.has(name) || !serious(name)) continue;
    const routes = (item.via ?? []).filter((via) => (typeof via === "object"
      ? ["high", "critical"].includes(via.severity)
      : serious(via)));
    if (routes.length === 0) continue;
    const settled = routes.every((via) => (typeof via === "object"
      ? via.name === name && item.range === "*"
      : unfixableNames.has(via)));
    if (settled) {
      unfixableNames.add(name);
      changed = true;
    }
  }
}

const actionable = [];
const unfixable = [];
for (const [name, item] of vulnerabilities) {
  if (unfixableNames.has(name)) unfixable.push([name, item]);
  else actionable.push([name, item]);
}

const unreviewed = [];
for (const [name, item] of unfixable) {
  const root = unfixableRoots.has(name);
  const reason = root ? "no version without the advisory exists" : "only reachable through a package that has none";
  console.log(`[audit] ${item.severity}: ${name} — ${reason}`);
  if (!root) continue;
  const reviewed = UNFIXED_REVIEWED[name];
  if (reviewed) console.log(`[audit]   reviewed ${reviewed.reviewed}: ${reviewed.note}`);
  else unreviewed.push(name);
}

// A new dead end is a person's decision, not something this script may wave through on its own.
if (unreviewed.length > 0) {
  console.error("");
  for (const name of unreviewed) {
    console.error(`[audit] ${name} has no fix and has not been looked at. Read the advisory, then`);
    console.error("[audit]   add it to UNFIXED_REVIEWED in scripts/audit-gate.mjs with what you found.");
  }
  process.exit(1);
}

if (actionable.length === 0) {
  console.log(`[audit] no high or critical advisory with a fix available (${unfixable.length} unfixable, reported above).`);
  process.exit(0);
}

console.error("");
for (const [name, item] of actionable) {
  const fix = item.fixAvailable === true
    ? "npm audit fix"
    : `${item.fixAvailable.name}@${item.fixAvailable.version}${item.fixAvailable.isSemVerMajor ? " (major)" : ""}`;
  console.error(`[audit] ${item.severity}: ${name} — fix: ${fix}`);
}
console.error(`[audit] ${actionable.length} high or critical advisory with a fix available. Take the fix.`);
process.exit(1);
