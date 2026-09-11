import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { verifyWhatsAppSignature } from "./messaging/webhook";
import { ConsoleProvider } from "./messaging/console";

describe("verifyWhatsAppSignature", () => {
  const secret = "app-secret";
  const body = JSON.stringify({ object: "whatsapp_business_account" });
  const validHeader = `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;

  it("accepts a correctly signed body", () => {
    expect(verifyWhatsAppSignature(body, validHeader, secret)).toBe(true);
  });

  it("accepts a Buffer body", () => {
    expect(verifyWhatsAppSignature(Buffer.from(body), validHeader, secret)).toBe(true);
  });

  it("rejects a tampered body", () => {
    expect(verifyWhatsAppSignature(`${body} `, validHeader, secret)).toBe(false);
  });

  it("rejects a wrong secret", () => {
    expect(verifyWhatsAppSignature(body, validHeader, "other-secret")).toBe(false);
  });

  it("rejects missing or malformed headers", () => {
    expect(verifyWhatsAppSignature(body, undefined, secret)).toBe(false);
    expect(verifyWhatsAppSignature(body, "sha256=deadbeef", secret)).toBe(false);
    expect(verifyWhatsAppSignature(body, "not-a-signature", secret)).toBe(false);
  });

  it("rejects when no secret is configured", () => {
    expect(verifyWhatsAppSignature(body, validHeader, "")).toBe(false);
  });
});

describe("ConsoleProvider", () => {
  const provider = new ConsoleProvider();

  it("accepts messages and derives ids from the idempotency key", async () => {
    const first = await provider.send({
      channel: "whatsapp",
      to: "+919000000001",
      templateCode: "outcome_pulse_90d",
      idempotencyKey: "manual:1:2026-09-11",
    });
    expect(first.status).toBe("accepted");
    expect(first.providerMessageId).toMatch(/^sim_/);

    const second = await provider.send({
      channel: "whatsapp",
      to: "+919000000001",
      templateCode: "outcome_pulse_90d",
      idempotencyKey: "manual:1:2026-09-11",
    });
    expect(second.providerMessageId).toBe(first.providerMessageId);
  });

  it("reports its provider name", () => {
    expect(provider.name).toBe("console");
  });
});
