// Bundles the Vercel serverless entry into a single self-contained ESM file.
// Uses esbuild's JS API so the createRequire banner is passed as a real string
// (avoids shell-quoting differences between Windows cmd and Linux sh).
import esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["server/_core/vercel-entry.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: "dist/serverless.mjs",
  // Allow bundled CommonJS deps (dotenv, etc.) to call require() under ESM.
  banner: {
    js: 'import{createRequire}from"node:module";const require=createRequire(import.meta.url);',
  },
  logLevel: "warning",
});

console.log("[build-serverless] dist/serverless.mjs written");
