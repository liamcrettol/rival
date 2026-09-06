import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { adminSupabase, withSupabaseTimeout } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// Reverse direction of the existing Rival -> Rerolled internal calls
// (lib/auth/signupCapacity.ts). Rerolled owns the shared signup-cap ledger
// and reconciles orphaned reservations for both sites (see the
// reconcile-signup-slots cron); for a reservation whose first_site is
// "rival" it has no local users table to check against, so it asks Rival
// here. Reuses REROLLED_SYNC_SECRET - the same shared secret Rival already
// sends when calling Rerolled - rather than provisioning a new one.
function authorized(req: NextRequest): boolean {
  const expected = process.env.REROLLED_SYNC_SECRET;
  const supplied = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!expected || supplied.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

const MAX_BATCH = 500;

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null) as { userIds?: unknown } | null;
  if (!Array.isArray(body?.userIds) || body.userIds.length === 0 || !body.userIds.every((id) => typeof id === "string")) {
    return NextResponse.json({ error: "userIds must be a non-empty string array" }, { status: 400 });
  }
  if (body.userIds.length > MAX_BATCH) {
    return NextResponse.json({ error: `userIds exceeds the ${MAX_BATCH}-id batch limit` }, { status: 400 });
  }

  try {
    // Check bungie_accounts, not users: the OAuth callback upserts users
    // before bungie_accounts, so a process killed in between leaves a users
    // row with no bungie_accounts row - a half-created account that
    // Rerolled's reconcile-signup-slots cron should still treat as an
    // orphaned slot, not a completed signup (mirrors #391 on Rerolled's side).
    const { data, error } = await withSupabaseTimeout(
      adminSupabase.from("bungie_accounts").select("user_id").in("user_id", body.userIds),
      2_000
    );
    if (error) throw new Error(error.message);

    return NextResponse.json(
      { existingUserIds: (data ?? []).map((row: { user_id: string }) => row.user_id) },
      { headers: { "Cache-Control": "no-store, private" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[internal/rerolled/account-exists] lookup failed", { reason: message });
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
