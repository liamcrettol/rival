import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/helpers";
import { adminSupabase } from "@/lib/supabase/admin";

// Cheap polling target for the dashboard while a backfill is in progress:
// two indexed lookups, no Bungie call, so it's safe to hit every few seconds.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireSession();
    const [{ data: state }, { count }] = await Promise.all([
      adminSupabase.from("crucible_sync_state").select("status").eq("user_id", session.userId).maybeSingle(),
      adminSupabase.from("crucible_encounters").select("instance_id", { count: "exact", head: true }).eq("viewer_user_id", session.userId),
    ]);
    return NextResponse.json({ status: state?.status ?? "idle", matchCount: count ?? 0 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to read Crucible sync status";
    return NextResponse.json({ ok: false, error: message }, { status: message === "Unauthorized" ? 401 : 500 });
  }
}
