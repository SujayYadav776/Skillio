import "dotenv/config";
import { createBaseApp, errorHandler } from "./app";

// Serverless entry that gets esbuild-bundled into a single self-contained
// ESM file (dist/serverless.mjs). The Vercel function (api/index.ts) re-exports
// this bundle so @vercel/node only transpiles one thin file — the codebase's
// extensionless relative imports are resolved at bundle time, not runtime.
const app = createBaseApp();
app.use(errorHandler);

export default app;
