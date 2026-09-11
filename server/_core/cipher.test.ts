import { describe, expect, it } from "vitest";
import { decrypt, decryptField, encrypt, encryptField, isEncryptedValue } from "./cipher";

describe("app-layer cipher (AES-256-GCM)", () => {
  it("round-trips a plaintext", () => {
    const payload = encrypt("+919000000001");
    expect(isEncryptedValue(payload)).toBe(true);
    expect(decrypt(payload)).toBe("+919000000001");
  });

  it("produces a different ciphertext for the same input (random IV)", () => {
    expect(encrypt("same")).not.toBe(encrypt("same"));
  });

  it("rejects a tampered payload", () => {
    const payload = encrypt("+919000000001");
    const [iv, tag, data] = payload.split(".");
    const tampered = Buffer.from(data, "base64");
    tampered[0] ^= 0xff;
    expect(() => decrypt(`${iv}.${tag}.${tampered.toString("base64")}`)).toThrow();
  });

  it("tolerates legacy plaintext through the field helpers", () => {
    expect(decryptField("+919000000001")).toBe("+919000000001");
    const encrypted = encryptField("+919000000001");
    expect(encrypted).not.toBe("+919000000001");
    expect(decryptField(encrypted)).toBe("+919000000001");
    expect(encryptField(null)).toBeNull();
    expect(decryptField(null)).toBeNull();
  });
});