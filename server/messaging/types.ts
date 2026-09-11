export type MessageChannel = "whatsapp" | "sms";

export type ProviderSendInput = {
  channel: MessageChannel;
  /** E.164 phone number of the recipient. */
  to: string;
  templateCode: string;
  /** Locale-specific template variables kept out of persistence. */
  templateVars?: Record<string, string>;
  idempotencyKey: string;
};

export type ProviderSendResult = {
  providerMessageId: string;
  status: "accepted" | "failed";
  errorCode?: string;
};

/**
 * Provider-neutral messaging boundary. Business logic only ever talks to this
 * interface — swapping ConsoleProvider for WhatsApp Cloud API (or an approved
 * aggregator) must not touch queries or routers.
 */
export interface MessagingProvider {
  readonly name: string;
  send(input: ProviderSendInput): Promise<ProviderSendResult>;
}

export class MessagingError extends Error {
  readonly errorCode: string;
  constructor(message: string, errorCode = "provider_error") {
    super(message);
    this.name = "MessagingError";
    this.errorCode = errorCode;
  }
}
