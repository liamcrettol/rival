import { NextRequest, NextResponse } from "next/server";
import { assertCronAuth } from "@/lib/auth/cron";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { listTrialsStats, needsTrialsStatsFetch } from "@/lib/crucible/trialsStatsStore";
import { refreshOpponents, type OpponentRef } from "@/lib/crucible/trialsBackfill";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const denied = assertCronAuth(request);
  if (denied) return denied;
  const db = createAdminSupabaseClient(15_000);
  try {
    const { data: accounts, error: accountError } = await db.from("bungie_accounts").select("user_id");
    if (accountError) throw new Error(`Backfill account lookup failed: ${accountError.message}`);
    const candidateResults = await Promise.all((accounts ?? []).map(async (account: { user_id: string }) => {
      const result = await db.rpc("get_trials_backfill_candidates_for_user", { p_viewer_user_id: account.user_id, p_limit: 100 });
      if (result.error) throw new Error(`Backfill candidate lookup failed: ${result.error.message}`);
      return result.data ?? [];
    }));
    const candidates = [...new Map(candidateResults.flat().map((candidate: { membership_id: string; membership_type: number | null }) => [candidate.membership_id, candidate])).values()];
    const cached = await listTrialsStats(candidates.map((candidate) => candidate.membership_id));
    const due: OpponentRef[] = candidates.filter((candidate) => needsTrialsStatsFetch(cached.get(candidate.membership_id)) && candidate.membership_type !== null).slice(0, 150).map((candidate) => ({ membershipId: candidate.membership_id, membershipType: candidate.membership_type as number }));
    const result = await refreshOpponents(due, { concurrency: 6, deadlineMs: Date.now() + 38_000 });
    return NextResponse.json({ ok: true, candidates: candidates.length, due: due.length, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
