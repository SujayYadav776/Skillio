import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// App-layer AES-256-GCM for PII fields (e.g. contactPhone). The key is derived
// from JWT_SECRET so the app carries one secret. Payload format:
//   <iv base64>.<authTag base64>.<ciphertext base64>
const IV_LEN = 12;
const TAG_LEN = 16;

function derivedKey(): Buffer {
  const secret = process.env.JWT_SECRET ?? process.env.ENCRYPTION_KEY ?? "dev-encryption-fallback-only";
  return createHash("sha256").update(secret).digest();
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", derivedKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`;
}

export function decrypt(payload: string): string {
  const parts = payload.split(".");
  if (parts.length !== 3) throw new Error("Invalid ciphertext payload");
  const [ivB64, tagB64, dataB64] = parts;
  const decipher = createDecipheriv("aes-256-gcm", derivedKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/** Heuristic detection so legacy plaintext values keep working after a migration. */
export function isEncryptedValue(value: string): boolean {
  // Three dot-separated base64 segments with only [A-Za-z0-9+/=].
  const [a, b, c] = value.split(".");
  if (!a || !b || !c || value.split(".").length !== 3) return false;
  return /^[A-Za-z0-9+/=]+$/.test(a) && /^[A-Za-z0-9+/=]+$/.test(b) && /^[A-Za-z0-9+/=]+$/.test(c);
}

/** Encrypt-on-write helper for a nullable PII column. */
export function encryptField(value: string | null | undefined): string | null {
  if (value == null || value === "") return value ?? null;
  return encrypt(value);
}

/** Decrypt-on-read helper that tolerates legacy plaintext rows. */
export function decryptField(value: string | null | undefined): string | null {
  if (value == null || value === "") return value ?? null;
  return isEncryptedValue(value) ? decrypt(value) : value;
}