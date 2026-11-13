import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { MachineAuthError, readBearerToken, type VerifyMachineToken } from "../application-access/machine-auth.js";
import type { SekretariatBuku } from "./buku.js";
import { SekretariatError } from "./db.js";

/** SEK-IMPL-001 §5.5 and §14 langkah 9. Loopback only; the edge answers 404 for `/internal/*`. */
export const SEKRETARIAT_INTERNAL_PREFIX = "/internal/sekretariat";

const alokasiSchema = z
  .object({
    penerbit_kode: z.string().regex(/^[A-Z0-9][A-Z0-9.-]{1,29}$/),
    jenis_kode: z.string().regex(/^[0-9A-Z][0-9A-Z-]{0,9}$/),
    perihal: z.string().trim().min(3).max(300),
    tujuan: z.string().trim().min(2).max(300),
    rujukan_modul: z.string().regex(/^[a-z][a-z0-9-]{1,40}$/),
    rujukan_id: z.string().trim().min(1).max(200),
  })
  .strict();

/**
 * The machine consumers' allocation path (first named consumer: HCIS after the cutover). A valid
 * service-account token from an allowlisted client is the whole authorization; D-3 makes the call
 * idempotent per (rujukan_modul, rujukan_id). Fail-closed: without the book there is no number
 * and no local fallback sequence.
 */
export function registerSekretariatInternalRoutes(
  app: FastifyInstance,
  input: { buku: SekretariatBuku; verifyMachineToken: VerifyMachineToken; log?: (entry: Record<string, unknown>, message: string) => void },
) {
  async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<string | null> {
    reply.header("Cache-Control", "no-store");
    const token = readBearerToken(request.headers.authorization);
    if (!token) {
      await reply.status(401).send({ error: "unauthenticated", message: "Token tidak ada." });
      return null;
    }
    try {
      return (await input.verifyMachineToken(token)).clientId;
    } catch (error) {
      if (error instanceof MachineAuthError) {
        const status = error.code === "FORBIDDEN_CLIENT" ? 403 : 401;
        await reply.status(status).send({ error: error.code === "FORBIDDEN_CLIENT" ? "consumer_unknown" : "unauthenticated", message: "Token tidak sah." });
        return null;
      }
      throw error;
    }
  }

  app.post(`${SEKRETARIAT_INTERNAL_PREFIX}/v1/alokasi-nomor`, async (request, reply) => {
    const clientId = await authenticate(request, reply);
    if (!clientId) return reply;
    const parsed = alokasiSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_request", message: "Permintaan tidak sah.", fields: parsed.error.issues.map((issue) => issue.path.join(".")) });
    }
    try {
      const result = await input.buku.allocateForMachine({
        clientId,
        penerbitKode: parsed.data.penerbit_kode,
        jenisKode: parsed.data.jenis_kode,
        perihal: parsed.data.perihal,
        tujuan: parsed.data.tujuan,
        rujukanModul: parsed.data.rujukan_modul,
        rujukanId: parsed.data.rujukan_id,
      });
      input.log?.({ event: "sekretariat.alokasi_mesin", clientId, sudahAda: result.sudahAda }, "sekretariat machine allocation");
      return reply.status(result.sudahAda ? 200 : 201).send({ id: result.id, nomor: result.nomor, tanggal: result.tanggal, sudah_ada: result.sudahAda });
    } catch (error) {
      if (error instanceof SekretariatError) {
        return reply.status(error.statusCode).send({ error: error.code, message: error.message });
      }
      input.log?.({ event: "sekretariat.alokasi_mesin_failed", errorType: error instanceof Error ? error.name : "unknown" }, "sekretariat machine allocation failed");
      return reply.status(503).send({ error: "sekretariat_unavailable", message: "Buku nomor sedang tidak tersedia." });
    }
  });
}
