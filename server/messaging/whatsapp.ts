import axios from "axios";
import { ENV, isWhatsAppConfigured } from "../_core/env";
import { MessagingError, type MessagingProvider, type ProviderSendInput, type ProviderSendResult } from "./types";

/**
 * WhatsApp Business Platform (Cloud API) provider. Template messages only —
 * free-form text is never sent by Skillio. Enabled by setting
 * WHATSAPP_PHONE_NUMBER_ID + WHATSAPP_ACCESS_TOKEN; otherwise unused.
 */
export class WhatsAppCloudProvider implements MessagingProvider {
  readonly name = "whatsapp_cloud";
  private readonly baseUrl = `https://graph.facebook.com/${ENV.whatsappApiVersion}/${ENV.whatsappPhoneNumberId}/messages`;

  async send(input: ProviderSendInput): Promise<ProviderSendResult> {
    if (!isWhatsAppConfigured()) {
      throw new MessagingError("WhatsApp Cloud API is not configured", "not_configured");
    }
    try {
      const response = await axios.post(
        this.baseUrl,
        {
          messaging_product: "whatsapp",
          to: input.to,
          type: "template",
          template: {
            name: input.templateCode,
            language: { code: "en" },
          },
        },
        {
          headers: {
            Authorization: `Bearer ${ENV.whatsappAccessToken}`,
            "Content-Type": "application/json",
          },
          timeout: 15_000,
        }
      );
      const messageId: string | undefined = response.data?.messages?.[0]?.id;
      if (!messageId) {
        throw new MessagingError("WhatsApp response missing message id", "invalid_response");
      }
      return { providerMessageId: messageId, status: "accepted" };
    } catch (error) {
      if (error instanceof MessagingError) throw error;
      if (axios.isAxiosError(error)) {
        const errorCode: string =
          (error.response?.data?.error?.code as number | undefined)?.toString() ??
          error.code ??
          "http_error";
        throw new MessagingError(
          `WhatsApp send failed: ${error.response?.data?.error?.message ?? error.message}`,
          errorCode
        );
      }
      throw new MessagingError("WhatsApp send failed unexpectedly");
    }
  }
}
