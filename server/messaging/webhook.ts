import crypto from "node:crypto";
import type { Express, Request, Response } from "express";
import { ENV } from "../_core/env";
import { handleInboundMessage, recordDeliveryStatus } from "../queries";

/** Constant-time comparison of the provider's HMAC-SHA256 body signature. */
export function verifyWhatsAppSignature(
  rawBody: string | Buffer,
  header: string | undefined,
  appSecret: string
): boolean {
  if (!appSecret || !header?.startsWith("sha256=")) return false;
  const expected = crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const provided = header.slice("sha256=".length);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(provided, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

type WhatsAppStatusEvent = { id?: string; status?: string; errors?: Array<{ code?: number }> };
type WhatsAppInboundMessage = { from?: string; type?: string };

const WEBHOOK_STATUSES = ["delivered", "read", "failed", "undelivered"] as const;

/**
 * Provider webhook endpoints:
 *  - GET  /api/webhooks/whatsapp — Meta subscription verification handshake
 *  - POST /api/webhooks/whatsapp — delivery statuses + inbound replies
 *
 * Auth: HMAC-SHA256 signature (X-Hub-Signature-256) when WHATSAPP_APP_SECRET is
 * set; otherwise a shared token header checked against WEBHOOK_VERIFY_TOKEN;
 * in development without either, requests are accepted with a loud warning.
 */
export function registerWebhookRoutes(app: Express) {
  app.get("/api/webhooks/whatsapp", (req: Request, res: Response) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && typeof token === "string" && token === ENV.webhookVerifyToken && ENV.webhookVerifyToken) {
      res.status(200).send(typeof challenge === "string" ? challenge : "");
      return;
    }
    res.sendStatus(403);
  });

  app.post("/api/webhooks/whatsapp", async (req: Request, res: Response) => {
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.from("{}");
    const signature = req.headers["x-hub-signature-256"] as string | undefined;
    const sharedToken = req.headers["x-webhook-token"] as string | undefined;

    if (ENV.whatsappAppSecret) {
      if (!verifyWhatsAppSignature(rawBody, signature, ENV.whatsappAppSecret)) {
        res.sendStatus(401);
        return;
      }
    } else if (ENV.webhookVerifyToken) {
      if (sharedToken !== ENV.webhookVerifyToken) {
        res.sendStatus(401);
        return;
      }
    } else if (ENV.isProduction) {
      res.sendStatus(401);
      return;
    } else {
      console.warn("[Webhook] accepting unsigned request in development — set WHATSAPP_APP_SECRET or WEBHOOK_VERIFY_TOKEN");
    }

    try {
      const payload = JSON.parse(rawBody.toString("utf8")) as {
        entry?: Array<{
          changes?: Array<{
            value?: {
              statuses?: WhatsAppStatusEvent[];
              messages?: WhatsAppInboundMessage[];
            };
          }>;
        }>;
      };

      for (const entry of payload.entry ?? []) {
        for (const change of entry.changes ?? []) {
          for (const statusEvent of change.value?.statuses ?? []) {
            const status = statusEvent.status;
            if (!statusEvent.id || !status || !(WEBHOOK_STATUSES as readonly string[]).includes(status)) continue;
            await recordDeliveryStatus({
              providerMessageId: statusEvent.id,
              status: status as (typeof WEBHOOK_STATUSES)[number],
              errorCode: statusEvent.errors?.[0]?.code?.toString() ?? null,
            });
          }
          for (const message of change.value?.messages ?? []) {
            if (!message.from) continue;
            // Inbound text content is intentionally not persisted.
            await handleInboundMessage({ contactPhone: message.from });
          }
        }
      }
      // Process BEFORE acknowledging: on serverless runtimes the container is
      // frozen once the response is sent, so fire-and-forget work would be
      // silently lost. Failures return 500 and Meta retries (idempotent).
      res.sendStatus(200);
    } catch (error) {
      console.error("[Webhook] processing failed:", error);
      if (!res.headersSent) res.sendStatus(500);
    }
  });
}
