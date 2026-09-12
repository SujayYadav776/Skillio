import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Request } from "express";
import { getUserByOpenId, upsertUser } from "../db";
import type { User } from "../../drizzle/schema";
import { isSupabaseAuthConfigured, ENV } from "./env";

type SupabaseUser = { sub: string; email?: string; name?: string };

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks() {
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${ENV.supabaseUrl}/auth/v1/.well-known/jwks.json`));
  }
  return jwks;
}

function extractAccessToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length);
  }
  // supabase-js sets this cookie when auth is stored in cookies
  const cookies = req.headers.cookie;
  if (cookies) {
    const match = cookies.match(/(?:^|;\s*)sb-access-token=([^;]+)/);
    if (match) {
      return decodeURIComponent(match[1]);
    }
  }
  return null;
}

async function verifySupabaseToken(token: string): Promise<SupabaseUser | null> {
  try {
    const { payload } = await jwtVerify(token, getJwks(), {
      issuer: `${ENV.supabaseUrl}/auth/v1`,
    });
    if (typeof payload.sub !== "string") return null;
    return {
      sub: payload.sub,
      email: typeof payload.email === "string" ? payload.email : undefined,
      name: typeof payload.name === "string" ? payload.name : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Resolves the signed-in user from a Supabase access token and mirrors it into
 * the local users table. Returns null when unauthenticated or when Supabase
 * auth is not configured.
 */
export async function getSupabaseUser(req: Request): Promise<User | null> {
  if (!isSupabaseAuthConfigured()) return null;

  const token = extractAccessToken(req);
  if (!token) return null;

  const claims = await verifySupabaseToken(token);
  if (!claims) return null;

  let user = await getUserByOpenId(claims.sub);
  if (!user) {
    await upsertUser({
      openId: claims.sub,
      name: claims.name,
      email: claims.email,
      loginMethod: "supabase",
      lastSignedIn: new Date(),
    });
    user = await getUserByOpenId(claims.sub);
  } else {
    await upsertUser({
      openId: claims.sub,
      name: claims.name,
      email: claims.email,
      lastSignedIn: new Date(),
    });
  }
  return user ?? null;
}
