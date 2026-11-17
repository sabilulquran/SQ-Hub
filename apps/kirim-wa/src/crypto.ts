import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * KIRIM-IMPL-005 §7 and §12. The worker seals the little message content it has to keep — the
 * history-import buffer, its message index and the stored result of a send — with keys of its own
 * (`KIRIM_WA_DATA_KEYS`). They are deliberately not the Hub's `KIRIM_DATA_KEYS`: the worker must
 * not be able to read `kirim_messages`, and a leak of the worker's keys must not open the
 * Yayasan's conversation history.
 *
 * The envelope is the same shape as the Hub's (KIRIM-IMPL-001 §4.1), so one rotation procedure
 * and one runbook cover both.
 */
const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const FILE_MAGIC = Buffer.from("KWA1", "ascii");

export class WaCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WaCryptoError";
  }
}

export class WaCrypto {
  private readonly keys: Map<string, Buffer>;
  private readonly writeKid: string;

  constructor(dataKeys: Array<{ kid: string; key: Buffer }>) {
    const first = dataKeys[0];
    if (!first) throw new WaCryptoError("at least one data key is required");
    this.keys = new Map(dataKeys.map((entry) => [entry.kid, entry.key]));
    this.writeKid = first.kid;
  }

  /** `v1.<kid>.<iv>.<ciphertext>.<tag>`; AAD binds the value to `kirim_wa:<table>:<column>:<row id>`. */
  seal(plaintext: string, aad: string): string {
    if (!plaintext) throw new WaCryptoError("cannot encrypt an empty value");
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, this.requireKey(this.writeKid), iv);
    cipher.setAAD(Buffer.from(aad, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return [VERSION, this.writeKid, iv.toString("base64url"), ciphertext.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
  }

  open(envelope: string, aad: string): string {
    const [version, kid, ivPart, ciphertextPart, tagPart, extra] = envelope.split(".");
    if (version !== VERSION || !kid || !ivPart || !ciphertextPart || !tagPart || extra !== undefined) {
      throw new WaCryptoError("invalid envelope");
    }
    const iv = Buffer.from(ivPart, "base64url");
    const ciphertext = Buffer.from(ciphertextPart, "base64url");
    const tag = Buffer.from(tagPart, "base64url");
    if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) throw new WaCryptoError("invalid envelope");
    try {
      const decipher = createDecipheriv(ALGORITHM, this.requireKey(kid), iv);
      decipher.setAAD(Buffer.from(aad, "utf8"));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    } catch (error) {
      if (error instanceof WaCryptoError) throw error;
      throw new WaCryptoError("envelope cannot be opened");
    }
  }

  /** JSON in one call, so no caller has to remember to stringify before sealing. */
  sealJson(value: unknown, aad: string): string {
    return this.seal(JSON.stringify(value), aad);
  }

  openJson<T>(envelope: string, aad: string): T {
    return JSON.parse(this.open(envelope, aad)) as T;
  }

  /**
   * Bytes on disk: magic, key-id length, key id, iv, ciphertext, tag. Same layout as the Hub's
   * media sealing (KIRIM-IMPL-001 D-8), so one recovery procedure covers both folders.
   */
  sealFileLike(data: Buffer, aad: string): Buffer {
    const kid = Buffer.from(this.writeKid, "ascii");
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, this.requireKey(this.writeKid), iv);
    cipher.setAAD(Buffer.from(aad, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
    return Buffer.concat([FILE_MAGIC, Buffer.from([kid.length]), kid, iv, ciphertext, cipher.getAuthTag()]);
  }

  openFileLike(sealed: Buffer, aad: string): Buffer {
    if (sealed.length < FILE_MAGIC.length + 1 + 12 + 16 || !sealed.subarray(0, FILE_MAGIC.length).equals(FILE_MAGIC)) {
      throw new WaCryptoError("invalid sealed file");
    }
    const kidLength = sealed[FILE_MAGIC.length]!;
    const kidEnd = FILE_MAGIC.length + 1 + kidLength;
    const kid = sealed.subarray(FILE_MAGIC.length + 1, kidEnd).toString("ascii");
    const iv = sealed.subarray(kidEnd, kidEnd + 12);
    const tag = sealed.subarray(sealed.length - 16);
    const ciphertext = sealed.subarray(kidEnd + 12, sealed.length - 16);
    if (iv.length !== 12 || tag.length !== 16) throw new WaCryptoError("invalid sealed file");
    try {
      const decipher = createDecipheriv(ALGORITHM, this.requireKey(kid), iv);
      decipher.setAAD(Buffer.from(aad, "utf8"));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch (error) {
      if (error instanceof WaCryptoError) throw error;
      throw new WaCryptoError("sealed file cannot be opened");
    }
  }

  private requireKey(kid: string): Buffer {
    const key = this.keys.get(kid);
    if (!key) throw new WaCryptoError(`unknown key id ${kid}`);
    return key;
  }
}

export function columnAad(table: string, column: string, rowId: string): string {
  return `kirim_wa:${table}:${column}:${rowId}`;
}

/** `kid:base64(32 bytes)` entries, comma separated; the first key writes, every key reads. */
export function parseDataKeys(value: string): Array<{ kid: string; key: Buffer }> {
  const entries = value.split(",").map((part) => part.trim()).filter(Boolean);
  if (entries.length === 0) throw new WaCryptoError("KIRIM_WA_DATA_KEYS must contain at least one key");
  const seen = new Set<string>();
  return entries.map((entry) => {
    const separator = entry.indexOf(":");
    const kid = separator > 0 ? entry.slice(0, separator) : "";
    const key = Buffer.from(entry.slice(separator + 1), "base64");
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(kid)) throw new WaCryptoError("KIRIM_WA_DATA_KEYS key id must match [A-Za-z0-9_-]{1,32}");
    if (key.length !== 32) throw new WaCryptoError(`KIRIM_WA_DATA_KEYS key ${kid} must be base64 of exactly 32 bytes`);
    if (seen.has(kid)) throw new WaCryptoError(`KIRIM_WA_DATA_KEYS key id ${kid} is duplicated`);
    seen.add(kid);
    return { kid, key };
  });
}
