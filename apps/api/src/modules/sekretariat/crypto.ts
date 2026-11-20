import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * SEK-IMPL-002 M-2: column encryption for the mailbox password. The envelope is the one Kirim SQ
 * already runs in production (`v1.<kid>.<iv>.<ciphertext>.<tag>`, AES-256-GCM, AAD-bound), but the
 * code and the keys are Sekretariat's own (M-2a): keys never derive from an OIDC secret, so
 * rotating that secret cannot make stored credentials unreadable.
 */
const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";

export class SekretariatCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SekretariatCryptoError";
  }
}

export class SekretariatCrypto {
  private readonly keys: Map<string, Buffer>;
  private readonly writeKid: string;

  constructor(dataKeys: Array<{ kid: string; key: Buffer }>) {
    const first = dataKeys[0];
    if (!first) throw new SekretariatCryptoError("at least one data key is required");
    this.keys = new Map(dataKeys.map((entry) => [entry.kid, entry.key]));
    this.writeKid = first.kid;
  }

  get keyIds(): string[] {
    return [...this.keys.keys()];
  }

  seal(plaintext: string, aad: string, kid = this.writeKid): string {
    if (!plaintext) throw new SekretariatCryptoError("cannot encrypt an empty value");
    const key = this.requireKey(kid);
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    cipher.setAAD(Buffer.from(aad, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return [VERSION, kid, iv.toString("base64url"), ciphertext.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
  }

  open(envelope: string, aad: string): string {
    const [version, kid, ivPart, ciphertextPart, tagPart, extra] = envelope.split(".");
    if (version !== VERSION || !kid || !ivPart || !ciphertextPart || !tagPart || extra !== undefined) {
      throw new SekretariatCryptoError("invalid envelope");
    }
    const iv = Buffer.from(ivPart, "base64url");
    const ciphertext = Buffer.from(ciphertextPart, "base64url");
    const tag = Buffer.from(tagPart, "base64url");
    if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) throw new SekretariatCryptoError("invalid envelope");
    try {
      const decipher = createDecipheriv(ALGORITHM, this.requireKey(kid), iv);
      decipher.setAAD(Buffer.from(aad, "utf8"));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    } catch (error) {
      if (error instanceof SekretariatCryptoError) throw error;
      // The reason is never more specific than this: a padding or tag detail would leak.
      throw new SekretariatCryptoError("envelope cannot be opened");
    }
  }

  private requireKey(kid: string): Buffer {
    const key = this.keys.get(kid);
    if (!key) throw new SekretariatCryptoError("unknown key id");
    return key;
  }
}

/** Binds a ciphertext to its row, so a mailbox password cannot be moved to another mailbox. */
export function mailboxAad(mailboxId: string): string {
  return `sekretariat:sekretariat_mailbox:sandi:${mailboxId}`;
}

/** `kid:base64(32 bytes)` separated by commas; the first key is the one new values are sealed with. */
export function parseSekretariatDataKeys(value: string): Array<{ kid: string; key: Buffer }> {
  const entries = value.split(",").map((part) => part.trim()).filter(Boolean);
  if (entries.length === 0) throw new Error("SEKRETARIAT_DATA_KEYS must contain at least one key");
  const seen = new Set<string>();
  return entries.map((entry) => {
    const separator = entry.indexOf(":");
    const kid = separator > 0 ? entry.slice(0, separator) : "";
    const key = Buffer.from(entry.slice(separator + 1), "base64");
    if (!/^[a-z0-9-]{1,32}$/.test(kid)) throw new Error("SEKRETARIAT_DATA_KEYS entries must look like <kid>:<base64 key>");
    if (seen.has(kid)) throw new Error("SEKRETARIAT_DATA_KEYS must not repeat a key id");
    if (key.length !== 32) throw new Error("each SEKRETARIAT_DATA_KEYS key must be 32 bytes once base64-decoded");
    seen.add(kid);
    return { kid, key };
  });
}
