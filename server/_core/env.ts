/**
 * Server environment. Only values the running application actually reads live
 * here — the Manus scaffold's OAuth/Forge/owner-id fields were removed along
 * with the code that consumed them.
 */
export const ENV = {
  isProduction: process.env.NODE_ENV === "production",

  // Supabase: Postgres, Auth (JWKS), and the private document bucket.
  supabaseUrl: process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? "",
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",

  // Messaging boundary (provider-neutral adapter selects the provider).
  whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? "",
  whatsappAccessToken: process.env.WHATSAPP_ACCESS_TOKEN ?? "",
  whatsappApiVersion: process.env.WHATSAPP_API_VERSION ?? "v21.0",
  whatsappAppSecret: process.env.WHATSAPP_APP_SECRET ?? "",
  webhookVerifyToken: process.env.WEBHOOK_VERIFY_TOKEN ?? "",
  schedulerEnabled: process.env.SCHEDULER_ENABLED !== "false",
};

export const isSupabaseAuthConfigured = () =>
  Boolean(ENV.supabaseUrl && (ENV.supabaseAnonKey || ENV.supabaseServiceRoleKey));

export const isWhatsAppConfigured = () =>
  Boolean(ENV.whatsappPhoneNumberId && ENV.whatsappAccessToken);
