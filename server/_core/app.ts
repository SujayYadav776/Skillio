import express from "express";
import type { NextFunction, Request, Response } from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerWebhookRoutes } from "../messaging/webhook";
import { appRouter } from "../routers";
import { createContext } from "./context";

/**
 * Builds the core Express app: body parsing, request-id logging, the messaging
 * webhook routes, and the tRPC API. It does NOT serve static files, start the
 * scheduler, or call listen() — those are left to the entry point so the same
 * app can run under a long-lived Node server (index.ts) or a Vercel function
 * (api/index.ts).
 */
export function createBaseApp(): express.Express {
  const app = express();

  // Configure body parser with larger size limit for file uploads.
  // rawBody is kept for webhook HMAC signature verification.
  app.use(
    express.json({
      limit: "50mb",
      verify: (req, _res, buf) => {
        (req as typeof req & { rawBody?: Buffer }).rawBody = buf;
      },
    })
  );
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // Observability: request logging + a scoped request id for audit correlation.
  app.use((req, res, next) => {
    const requestId =
      (req.headers["x-request-id"] as string | undefined) ??
      `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    res.setHeader("x-request-id", requestId);
    (req as typeof req & { requestId?: string }).requestId = requestId;
    const start = Date.now();
    res.on("finish", () => {
      const ms = Date.now() - start;
      console.log(`[http] ${req.method} ${req.originalUrl} -> ${res.statusCode} ${ms}ms rid=${requestId}`);
    });
    next();
  });

  // Vercel may invoke the exported function with the "/api" prefix stripped
  // from req.url depending on routing config. Re-add it for tRPC/webhook
  // requests so the "/api/..." routes below match either way. No-op in dev.
  app.use((req, _res, next) => {
    const url = req.url || "";
    if (
      !url.startsWith("/api") &&
      (url.startsWith("/trpc") || url.startsWith("/webhooks"))
    ) {
      req.url = "/api" + url;
    }
    next();
  });

  registerWebhookRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );

  return app;
}

/**
 * Centralized error handler: log server-side failures without leaking
 * internals. Registered last (after any static/SPA fallback) in each entry.
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  console.error("[error]", err);
  if (res.headersSent) {
    return;
  }
  res.status(500).json({ error: "Internal server error" });
}
