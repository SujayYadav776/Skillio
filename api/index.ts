// Vercel function entry. Kept intentionally thin: it re-exports the
// esbuild-bundled, self-contained server (dist/serverless.mjs) produced by
// `pnpm build`. This way @vercel/node transpiles only this one file, whose
// single relative import carries an explicit extension, avoiding the ESM
// loader error on the codebase's extensionless internal imports.
export { default } from "../dist/serverless.mjs";
