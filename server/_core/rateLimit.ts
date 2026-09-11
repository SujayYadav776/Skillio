import type { TrpcContext } from "./context";

type Bucket = { count: number; resetAt: number };

// In-memory token buckets, keyed by client IP. Fine for a single-node app; for
// horizontal scale this should move to a shared store (e.g. Redis).
const buckets = new Map<string, Bucket>();
let lastCleanup = 0;

function cleanup(now: number) {
  if (now - lastCleanup < 60_000) return;
  lastCleanup = now;
  buckets.forEach((bucket, key) => {
    if (bucket.resetAt <= now) buckets.delete(key);
  });
}

export function createRateLimiter(options: { windowMs: number; max: number }) {
  return function allow(key: string): { ok: boolean; retryAfterMs: number } {
    const now = Date.now();
    cleanup(now);
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + options.windowMs };
    }
    bucket.count += 1;
    buckets.set(key, bucket);
    if (bucket.count > options.max) {
      return { ok: false, retryAfterMs: bucket.resetAt - now };
    }
    return { ok: true, retryAfterMs: 0 };
  };
}

/** Best available client address, honouring a single-hop X-Forwarded-For. */
export function clientIp(ctx: TrpcContext): string {
  const forwarded = ctx.req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    const ip = forwarded.split(",")[0].trim();
    if (ip) return ip;
  }
  return ctx.req.socket?.remoteAddress ?? "unknown";
}