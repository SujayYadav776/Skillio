import { createHash } from "node:crypto";
import type { MessagingProvider, ProviderSendInput, ProviderSendResult } from "./types";

/**
 * Development provider: accepts every message, derives a deterministic
 * provider id from the idempotency key, and logs the delivery. No network.
 */
export class ConsoleProvider implements MessagingProvider {
  readonly name = "console";

  async send(input: ProviderSendInput): Promise<ProviderSendResult> {
    const providerMessageId = `sim_${createHash("sha256")
      .update(input.idempotencyKey)
      .digest("hex")
      .slice(0, 24)}`;
    console.log(
      `[Messaging:${this.name}] ${input.channel} → ${input.to} template=${input.templateCode} id=${providerMessageId}`
    );
    return { providerMessageId, status: "accepted" };
  }
}
