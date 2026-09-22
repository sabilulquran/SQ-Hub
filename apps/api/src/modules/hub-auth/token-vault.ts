import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const AAD = Buffer.from("sq-hub-account-refresh-token-v1", "utf8");

export class HubTokenVault {
  private readonly key: Buffer;

  constructor(clientSecret: string) {
    if (!clientSecret) throw new Error("OIDC client secret is required for token encryption");
    this.key = Buffer.from(
      hkdfSync(
        "sha256",
        Buffer.from(clientSecret, "utf8"),
        Buffer.from("sq-hub-token-vault-v1", "utf8"),
        Buffer.from("account-refresh-token", "utf8"),
        32,
      ),
    );
  }

  seal(value: string): string {
    if (!value) throw new Error("cannot encrypt an empty token");
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    cipher.setAAD(AAD);
    const ciphertext = Buffer.concat([
      cipher.update(value, "utf8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return [
      VERSION,
      iv.toString("base64url"),
      ciphertext.toString("base64url"),
      tag.toString("base64url"),
    ].join(".");
  }

  open(envelope: string): string {
    const [version, ivPart, ciphertextPart, tagPart, extra] = envelope.split(".");
    if (
      version !== VERSION ||
      !ivPart ||
      !ciphertextPart ||
      !tagPart ||
      extra !== undefined
    ) {
      throw new Error("invalid encrypted token envelope");
    }

    const iv = Buffer.from(ivPart, "base64url");
    const ciphertext = Buffer.from(ciphertextPart, "base64url");
    const tag = Buffer.from(tagPart, "base64url");
    if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) {
      throw new Error("invalid encrypted token envelope");
    }

    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAAD(AAD);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  }
}
