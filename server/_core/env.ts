export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  // Supabase (database + auth)
  supabaseUrl: process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? "",
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  // Messaging (Phase 4)
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
