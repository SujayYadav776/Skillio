import "dotenv/config";
import { createBaseApp, errorHandler } from "../server/_core/app";

// Vercel serverless entry: build the API-only Express app (tRPC + webhooks)
// and export it as the request handler. No listen(), no scheduler, and no
// static file serving — Vercel's CDN serves the built client from
// dist/public, and this function only handles /api/* traffic.
const app = createBaseApp();
app.use(errorHandler);

export default app;
