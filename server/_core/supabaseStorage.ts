import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ENV } from "./env";

export const DOCUMENT_BUCKET = "employee-documents";

let storageClient: SupabaseClient | null = null;
let bucketReady: Promise<void> | null = null;

/**
 * Service-role storage client for the private employee document vault.
 * Signed URLs are minted per-request; nothing is public.
 */
function getClient(): SupabaseClient {
  if (!ENV.supabaseUrl || !ENV.supabaseServiceRoleKey) {
    throw new Error("Storage unavailable: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set");
  }
  if (!storageClient) {
    storageClient = createClient(ENV.supabaseUrl, ENV.supabaseServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return storageClient;
}

async function ensureBucket(): Promise<SupabaseClient> {
  const client = getClient();
  if (!bucketReady) {
    bucketReady = (async () => {
      const { error } = await client.storage.createBucket(DOCUMENT_BUCKET, { public: false });
      // "already exists" and duplicate-key noise both mean we are fine.
      if (error && !/exist|duplicate/i.test(error.message)) {
        throw error;
      }
    })().catch((error) => {
      bucketReady = null;
      throw error;
    });
  }
  await bucketReady;
  return client;
}

export async function uploadDocumentObject(
  path: string,
  data: Buffer,
  contentType: string
): Promise<void> {
  const client = await ensureBucket();
  const { error } = await client.storage.from(DOCUMENT_BUCKET).upload(path, data, {
    contentType,
    upsert: false,
  });
  if (error) throw error;
}

/** Short-lived private download URL (default 5 minutes). */
export async function createDocumentUrl(path: string, expiresInSeconds = 300): Promise<string> {
  const client = await ensureBucket();
  const { data, error } = await client.storage
    .from(DOCUMENT_BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error || !data) throw error ?? new Error("Failed to create signed URL");
  return data.signedUrl;
}

export async function deleteDocumentObject(path: string): Promise<void> {
  const client = await ensureBucket();
  const { error } = await client.storage.from(DOCUMENT_BUCKET).remove([path]);
  if (error) throw error;
}
