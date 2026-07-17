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
    const { data, error } = await db.rpc("get_trials_backfill_candidates", { p_limit: 500 });
    if (error) throw new Error(`Backfill candidate lookup failed: ${error.message}`);
    const candidates = (data ?? []) as { membership_id: string; membership_type: number | null }[];
    const cached = await listTrialsStats(candidates.map((candidate) => candidate.membership_id));
    const due: OpponentRef[] = candidates.filter((candidate) => needsTrialsStatsFetch(cached.get(candidate.membership_id)) && candidate.membership_type !== null).slice(0, 150).map((candidate) => ({ membershipId: candidate.membership_id, membershipType: candidate.membership_type as number }));
    const result = await refreshOpponents(due, { concurrency: 6, deadlineMs: Date.now() + 38_000 });
    return NextResponse.json({ ok: true, candidates: candidates.length, due: due.length, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
