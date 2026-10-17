import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * KIRIM-IMPL-001 §4.1 column encryption and lookup. Keys are Kirim-specific and never derived
 * from OIDC secrets, so rotating an OIDC secret cannot make history unreadable.
 */
const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const FILE_MAGIC = Buffer.from("KSQ1", "ascii");

export class KirimCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KirimCryptoError";
  }
}

export class KirimCrypto {
  private readonly keys: Map<string, Buffer>;
  private readonly writeKid: string;

  constructor(dataKeys: Array<{ kid: string; key: Buffer }>, private readonly lookupKey: Buffer) {
    const first = dataKeys[0];
    if (!first) throw new KirimCryptoError("at least one data key is required");
    this.keys = new Map(dataKeys.map((entry) => [entry.kid, entry.key]));
    this.writeKid = first.kid;
  }

  get keyIds(): string[] {
    return [...this.keys.keys()];
  }

  /** `v1.<kid>.<iv>.<ciphertext>.<tag>`; AAD binds the value to `kirim:<table>:<column>:<row id>`. */
  seal(plaintext: string, aad: string, kid = this.writeKid): string {
    if (!plaintext) throw new KirimCryptoError("cannot encrypt an empty value");
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
      throw new KirimCryptoError("invalid envelope");
    }
    const iv = Buffer.from(ivPart, "base64url");
    const ciphertext = Buffer.from(ciphertextPart, "base64url");
    const tag = Buffer.from(tagPart, "base64url");
    if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) throw new KirimCryptoError("invalid envelope");
    try {
      const decipher = createDecipheriv(ALGORITHM, this.requireKey(kid), iv);
      decipher.setAAD(Buffer.from(aad, "utf8"));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    } catch (error) {
      if (error instanceof KirimCryptoError) throw error;
      throw new KirimCryptoError("envelope cannot be opened");
    }
  }

  /** D-8: media files on disk are encrypted with the same data key. Layout: magic, kid length, kid, iv, ciphertext, tag. */
  sealFile(data: Buffer, aad: string): Buffer {
    const key = this.requireKey(this.writeKid);
    const kid = Buffer.from(this.writeKid, "ascii");
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    cipher.setAAD(Buffer.from(aad, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
    return Buffer.concat([FILE_MAGIC, Buffer.from([kid.length]), kid, iv, ciphertext, cipher.getAuthTag()]);
  }

  openFile(sealed: Buffer, aad: string): Buffer {
    if (sealed.length < FILE_MAGIC.length + 1 + 12 + 16 || !sealed.subarray(0, 4).equals(FILE_MAGIC)) {
      throw new KirimCryptoError("invalid sealed file");
    }
    const kidLength = sealed[4]!;
    const kidEnd = 5 + kidLength;
    const kid = sealed.subarray(5, kidEnd).toString("ascii");
    const iv = sealed.subarray(kidEnd, kidEnd + 12);
    const tag = sealed.subarray(sealed.length - 16);
    const ciphertext = sealed.subarray(kidEnd + 12, sealed.length - 16);
    try {
      const decipher = createDecipheriv(ALGORITHM, this.requireKey(kid), iv);
      decipher.setAAD(Buffer.from(aad, "utf8"));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch (error) {
      if (error instanceof KirimCryptoError) throw error;
      throw new KirimCryptoError("sealed file cannot be opened");
    }
  }

  /** Hex HMAC-SHA256 of a canonical value (`pn:+62…` or `lid:<jid>`). */
  lookup(canonical: string): string {
    return createHmac("sha256", this.lookupKey).update(canonical, "utf8").digest("hex");
  }

  private requireKey(kid: string): Buffer {
    const key = this.keys.get(kid);
    if (!key) throw new KirimCryptoError("unknown key id");
    return key;
  }
}

export function columnAad(table: string, column: string, rowId: string): string {
  return `kirim:${table}:${column}:${rowId}`;
}

export class InvalidNumberError extends Error {
  readonly code = "invalid_number";
  constructor() {
    super("invalid number");
    this.name = "InvalidNumberError";
  }
}

/**
 * §4.1: remove spaces, hyphens and brackets; `08…` and `628…` become `+628…`; the result must
 * be `+` followed by 8–15 digits.
 */
export function normalizePhone(input: string): string {
  const compact = input.trim().replace(/[\s\-()]/g, "");
  let candidate = compact;
  if (compact.startsWith("08")) candidate = `+62${compact.slice(1)}`;
  else if (compact.startsWith("628")) candidate = `+${compact}`;
  if (!/^\+\d{8,15}$/.test(candidate)) throw new InvalidNumberError();
  return candidate;
}

export function phoneCanonical(e164: string): string {
  return `pn:${e164}`;
}

/** `+62 812-••••-7890`: country code and operator prefix plus the last four digits only. */
export function maskPhone(e164: string): string {
  const digits = e164.replace(/^\+/, "");
  const last4 = digits.slice(-4);
  if (digits.length < 11) return `+${digits.slice(0, 2)} ••••-${last4}`;
  return `+${digits.slice(0, 2)} ${digits.slice(2, 5)}-••••-${last4}`;
}

export function signKirimWebhook(secret: string, timestamp: number, rawBody: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
}

/** §6.3: `x-jalurpesan-signature` = `v1=` hex HMAC-SHA256(secret, `timestamp.body`), 5-minute tolerance. */
export function verifyJalurPesanSignature(input: {
  secret: string;
  signature: string | undefined;
  timestamp: string | undefined;
  rawBody: string;
  nowSeconds: number;
  toleranceSeconds?: number;
}): boolean {
  if (!input.signature || !input.timestamp || !/^\d{1,12}$/.test(input.timestamp)) return false;
  const timestamp = Number(input.timestamp);
  if (Math.abs(input.nowSeconds - timestamp) > (input.toleranceSeconds ?? 300)) return false;
  const expected = Buffer.from(`v1=${createHmac("sha256", input.secret).update(`${timestamp}.${input.rawBody}`, "utf8").digest("hex")}`, "utf8");
  const actual = Buffer.from(input.signature, "utf8");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
