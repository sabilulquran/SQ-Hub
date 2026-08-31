import { loadFoundationConfig } from "../config.js";
import { createPool } from "../db/pool.js";
import type { ActorKind } from "../modules/application-access/types.js";
import { PgPlatformAdminRepository } from "../modules/platform-admin/repository.js";
import { PlatformAdminService } from "../modules/platform-admin/service.js";

const config = loadFoundationConfig();
const pool = createPool(config.databaseUrl);
const service = new PlatformAdminService(new PgPlatformAdminRepository(pool));
const args = process.argv.slice(2);

function value(name: string, required = true): string | undefined {
  const index = args.indexOf(name);
  const found = index >= 0 ? args[index + 1] : undefined;
  if (required && (!found || found.startsWith("--"))) {
    throw new Error(`Missing ${name}`);
  }
  return found;
}

function identity() {
  const issuer = value("--issuer");
  const subject = value("--subject");
  if (!issuer || !subject) throw new Error("Missing identity");
  return { issuer, subject };
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

async function main() {
  const [action] = args;

  if (action === "show") {
    console.log(JSON.stringify(await service.show(identity()), null, 2));
    return;
  }

  if (action === "grant" || action === "revoke") {
    const reason = value("--reason");
    if (!reason) throw new Error("Missing --reason");
    const input = {
      identity: identity(),
      reason,
      actor: actor(),
    };
    const result = action === "grant" ? await service.grant(input) : await service.revoke(input);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (action === "audit") {
    const limitRaw = value("--limit", false);
    const limit = limitRaw ? Number(limitRaw) : undefined;
    console.log(JSON.stringify(await service.listAudit(identity(), limit), null, 2));
    return;
  }

  throw new Error(
    [
      "Usage:",
      "  show --issuer <issuer> --subject <sub>",
      "  grant --issuer <issuer> --subject <sub> --reason <text> --actor <ref> [--actor-kind human|service|system]",
      "  revoke --issuer <issuer> --subject <sub> --reason <text> --actor <ref> [--actor-kind human|service|system]",
      "  audit --issuer <issuer> --subject <sub> [--limit <n>]",
    ].join("\n"),
  );
}

try {
  await main();
} finally {
  await pool.end();
}
