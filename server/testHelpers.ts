import type { TrpcContext } from "./_core/context";
import type { User } from "../drizzle/schema";

/** Factory for the admin test user (shared across test files). */
export function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 1,
    openId: "test-admin",
    name: "Test Admin",
    email: "admin@test.local",
    loginMethod: "supabase",
    role: "admin",
    district: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
    ...overrides,
  };
}

export function makeContext(user: User | null = makeUser()): TrpcContext {
  return {
    user,
    req: { protocol: "http", headers: {} },
    res: { clearCookie: () => {} },
  } as unknown as TrpcContext;
}
