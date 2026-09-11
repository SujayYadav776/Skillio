import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rateLimit";

describe("rate limiter", () => {
  it("allows up to max requests then rejects", () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 3 });
    expect(limiter("ip-a").ok).toBe(true);
    expect(limiter("ip-a").ok).toBe(true);
    expect(limiter("ip-a").ok).toBe(true);
    const fourth = limiter("ip-a");
    expect(fourth.ok).toBe(false);
    expect(fourth.retryAfterMs).toBeGreaterThan(0);
    // Other keys are unaffected.
    expect(limiter("ip-b").ok).toBe(true);
  });

  it("resets the window once it elapses", () => {
    const limiter = createRateLimiter({ windowMs: 20, max: 1 });
    expect(limiter("ip-x").ok).toBe(true);
    expect(limiter("ip-x").ok).toBe(false);
    return new Promise((resolve) => {
      setTimeout(() => {
        expect(limiter("ip-x").ok).toBe(true);
        resolve(null);
      }, 30);
    });
  });
});