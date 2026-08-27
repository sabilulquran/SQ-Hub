import { loadConfig } from "../config.js";
import { createPool } from "../db/pool.js";
import { PgApplicationAccessRepository, makeAccessTargetRef } from "../modules/application-access/repository.js";
import { ApplicationAccessService } from "../modules/application-access/service.js";
import type { ActorKind } from "../modules/application-access/types.js";

const config = loadConfig();
const pool = createPool(config.databaseUrl);
const service = new ApplicationAccessService(new PgApplicationAccessRepository(pool));
const args = process.argv.slice(2);

function value(name: string, required = true): string | undefined {
  const index = args.indexOf(name);
  const found = index >= 0 ? args[index + 1] : undefined;
  if (required && (!found || found.startsWith("--"))) {
    throw new Error(`Missing ${name}`);
  }
  return found;
}

function actor() {
  const ref = value("--actor");
  const kind = (value("--actor-kind", false) ?? "human") as ActorKind;
  if (!ref) throw new Error("Missing --actor");
  if (!(["human", "service", "system"] as const).includes(kind)) {
    throw new Error("--actor-kind must be human, service, or system");
  }
  return { kind, ref };
}

function identity() {
  const issuer = value("--issuer");
  const subject = value("--subject");
  if (!issuer || !subject) throw new Error("Missing identity");
  return { issuer, subject };
}

async function main() {
  const [area, action] = args;

  if (area === "application" && action === "list") {
    console.log(JSON.stringify(await service.listApplications(), null, 2));
    return;
  }

  if (area === "application" && action === "upsert") {
    const applicationKey = value("--key");
    const name = value("--name");
    const canonicalUrl = value("--url");
    const status = value("--status") as "active" | "inactive" | undefined;
    if (!applicationKey || !name || !canonicalUrl || !status) throw new Error("Missing application fields");
    if (status !== "active" && status !== "inactive") throw new Error("--status must be active or inactive");
    console.log(
      JSON.stringify(
        await service.upsertApplication({ applicationKey, name, canonicalUrl, status, actor: actor() }),
        null,
        2,
      ),
    );
    return;
  }

  if (area === "access" && (action === "grant" || action === "revoke")) {
    const applicationKey = value("--app");
    if (!applicationKey) throw new Error("Missing --app");
    const input = {
      identity: identity(),
      applicationKey,
      reason: value("--reason", false) ?? null,
      actor: actor(),
    };
    const result = action === "grant" ? await service.grant(input) : await service.revoke(input);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (area === "access" && action === "show") {
    const applicationKey = value("--app");
    if (!applicationKey) throw new Error("Missing --app");
    console.log(JSON.stringify(await service.getAccess(identity(), applicationKey), null, 2));
    return;
  }

  if (area === "audit" && action === "list") {
    const target = value("--target", false);
    const limitRaw = value("--limit", false);
    const limit = limitRaw ? Number(limitRaw) : undefined;
    console.log(JSON.stringify(await service.listAudit(target, limit), null, 2));
    return;
  }

  if (area === "access" && action === "target-ref") {
    const applicationKey = value("--app");
    if (!applicationKey) throw new Error("Missing --app");
    console.log(makeAccessTargetRef(identity(), applicationKey));
    return;
  }

  throw new Error(
    [
      "Usage:",
      "  application list",
      "  application upsert --key <key> --name <name> --url <url> --status active|inactive --actor <ref>",
      "  access grant --issuer <issuer> --subject <sub> --app <key> [--reason <text>] --actor <ref>",
      "  access revoke --issuer <issuer> --subject <sub> --app <key> [--reason <text>] --actor <ref>",
      "  access show --issuer <issuer> --subject <sub> --app <key>",
      "  audit list [--target <targetRef>] [--limit <n>]",
    ].join("\n"),
  );
}

try {
  await main();
} finally {
  await pool.end();
}
