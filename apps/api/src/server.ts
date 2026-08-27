import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createPool } from "./db/pool.js";
import { createKeycloakMachineTokenVerifier } from "./modules/application-access/machine-auth.js";
import { PgApplicationAccessRepository } from "./modules/application-access/repository.js";
import { ApplicationAccessService } from "./modules/application-access/service.js";

const config = loadConfig();
const pool = createPool(config.databaseUrl);
const repository = new PgApplicationAccessRepository(pool);
const accessService = new ApplicationAccessService(repository);
const verifyMachineToken = createKeycloakMachineTokenVerifier({
  issuer: config.keycloakIssuer,
  audience: config.machineTokenAudience,
  allowedClients: config.allowedMachineClients,
});

const app = buildApp({ accessService, verifyMachineToken, logger: true });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  await app.close();
  await pool.end();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ port: config.port, host: "0.0.0.0" });
} catch (error) {
  app.log.error(error);
  await pool.end();
  process.exit(1);
}
