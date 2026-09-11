import { ENV, isWhatsAppConfigured } from "../_core/env";
import { ConsoleProvider } from "./console";
import { WhatsAppCloudProvider } from "./whatsapp";
import type { MessagingProvider } from "./types";

let provider: MessagingProvider | null = null;

/** The active provider: WhatsApp Cloud API when configured, console otherwise. */
export function getMessagingProvider(): MessagingProvider {
  if (!provider) {
    provider = isWhatsAppConfigured() ? new WhatsAppCloudProvider() : new ConsoleProvider();
  }
  return provider;
}

/** Test seam: inject a provider (e.g. a stub) for the current process. */
export function setMessagingProvider(next: MessagingProvider | null) {
  provider = next;
}

export type { MessagingProvider, ProviderSendInput, ProviderSendResult } from "./types";
export { MessagingError } from "./types";
export { ENV };
