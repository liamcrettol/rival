import { createClient } from "@supabase/supabase-js";
import { adminSupabase } from "@/lib/supabase/admin";

type SourceAccount = {
  user_id: string;
  membership_id: string;
  membership_type: number;
};

type SourceUser = {
  id: string;
  display_name: string;
};

// Keep Rival's background-sync roster aligned with every Bungie account on
// the main site. OAuth ciphertext is deliberately not copied: the two apps
// use different encryption keys and OAuth clients, and rotating a copied
// refresh token would break the source site's session. Public history reads
// use only the Bungie application API key instead.
export async function syncSiteCrucibleRoster(): Promise<number> {
  const sourceUrl = process.env.REROLLED_SUPABASE_URL;
  const sourceServiceKey = process.env.REROLLED_SUPABASE_SERVICE_ROLE_KEY;
  if (!sourceUrl || !sourceServiceKey) return 0;

  const source = createClient(sourceUrl, sourceServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: sourceAccounts, error: accountError } = await source
    .from("bungie_accounts")
    .select("user_id,membership_id,membership_type");
  if (accountError) throw new Error(`Site Bungie roster read failed: ${accountError.message}`);

  const accounts = (sourceAccounts ?? []) as SourceAccount[];
  if (accounts.length === 0) return 0;

  const userIds = [...new Set(accounts.map((account) => account.user_id))];
  const { data: sourceUsers, error: userError } = await source
    .from("users")
    .select("id,display_name")
    .in("id", userIds);
  if (userError) throw new Error(`Site user roster read failed: ${userError.message}`);

  const users = (sourceUsers ?? []) as SourceUser[];
  const now = new Date().toISOString();
  const { error: userUpsertError } = await adminSupabase.from("users").upsert(
    users.map((user) => ({ ...user, updated_at: now })),
    { onConflict: "id" },
  );
  if (userUpsertError) throw new Error(`Rival site user mirror failed: ${userUpsertError.message}`);

  const { data: existingRows, error: existingError } = await adminSupabase
    .from("bungie_accounts")
    .select("user_id,public_history_sync")
    .in("user_id", userIds);
  if (existingError) throw new Error(`Rival Bungie roster lookup failed: ${existingError.message}`);

  const existing = new Map(
    (existingRows ?? []).map((row: { user_id: string; public_history_sync: boolean }) => [row.user_id, row]),
  );
  const missing = accounts.filter((account) => !existing.has(account.user_id));
  if (missing.length > 0) {
    const { error } = await adminSupabase.from("bungie_accounts").insert(
      missing.map((account) => ({
        ...account,
        access_token_enc: "",
        refresh_token_enc: null,
        expires_at: null,
        oauth_client_id: null,
        public_history_sync: true,
        updated_at: now,
      })),
    );
    if (error) throw new Error(`Rival Bungie roster insert failed: ${error.message}`);
  }

  // Membership/platform changes should follow the source for mirrored rows,
  // but never overwrite an account that has authenticated directly to Rival.
  for (const account of accounts) {
    if (!existing.get(account.user_id)?.public_history_sync) continue;
    const { error } = await adminSupabase
      .from("bungie_accounts")
      .update({
        membership_id: account.membership_id,
        membership_type: account.membership_type,
        updated_at: now,
      })
      .eq("user_id", account.user_id)
      .eq("public_history_sync", true);
    if (error) throw new Error(`Rival mirrored Bungie account update failed: ${error.message}`);
  }

  return accounts.length;
}
