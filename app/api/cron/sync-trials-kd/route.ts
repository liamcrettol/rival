import { NextRequest, NextResponse } from "next/server";
import { assertCronAuth } from "@/lib/auth/cron";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { listTrialsStats, needsTrialsStatsFetch, isTrialsStatsQuotaError } from "@/lib/crucible/trialsStatsStore";
import { refreshOpponents, type OpponentRef } from "@/lib/crucible/trialsBackfill";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Generous ceiling on the account scan - current user base is far under this,
// it just stops the fan-out from growing unbounded as the base grows.
const MAX_BACKFILL_ACCOUNTS = 2000;
// Same concurrency ceiling refreshOpponents() below already uses for its own
// Bungie-facing fan-out.
const ACCOUNT_LOOKUP_CONCURRENCY = 6;

async function mapConcurrently<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  const queue = items.map((item, index) => ({ item, index }));
  const runners = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (;;) {
      const next = queue.shift();
      if (!next) return;
      results[next.index] = await worker(next.item);
    }
  });
  await Promise.all(runners);
  return results;
}

export async function GET(request: NextRequest) {
  const denied = assertCronAuth(request);
  if (denied) return denied;
  const db = createAdminSupabaseClient(15_000);
  try {
    const { data: accounts, error: accountError } = await db.from("bungie_accounts").select("user_id").limit(MAX_BACKFILL_ACCOUNTS);
    if (accountError) throw new Error(`Backfill account lookup failed: ${accountError.message}`);
    // Isolated per-account: one account's RPC failing shouldn't sink the
    // whole run, since the rest self-heal on the next 15-minute cycle anyway.
    const candidateResults = await mapConcurrently(accounts ?? [], ACCOUNT_LOOKUP_CONCURRENCY, async (account: { user_id: string }) => {
      const result = await db.rpc("get_trials_backfill_candidates_for_user", { p_viewer_user_id: account.user_id, p_limit: 300 });
      if (result.error) {
        console.error("[cron/sync-trials-kd] Backfill candidate lookup failed for account, skipping", {
          error: result.error.message,
        });
        return [];
      }
      return result.data ?? [];
    });
    const candidates = [...new Map(candidateResults.flat().map((candidate: { membership_id: string; membership_type: number | null }) => [candidate.membership_id, candidate])).values()];

    let cached;
    try {
      cached = await listTrialsStats(candidates.map((candidate) => candidate.membership_id));
    } catch (error) {
      if (!isTrialsStatsQuotaError(error)) throw error;
      // Appwrite read quota exhausted for the billing cycle - this is an
      // expected, recoverable condition (same as the Hall of Fame read
      // path), not a cron failure. Skip this run's refresh instead of
      // reddening it; the next run picks candidates back up once quota
      // resets.
      console.error("[cron/sync-trials-kd] Appwrite read quota exhausted, skipping this run", {
        candidates: candidates.length,
      });
      return NextResponse.json({ ok: true, skipped: "appwrite_quota_exhausted", candidates: candidates.length, due: 0 });
    }

    const due: OpponentRef[] = candidates.filter((candidate) => needsTrialsStatsFetch(cached.get(candidate.membership_id)) && candidate.membership_type !== null).slice(0, 150).map((candidate) => ({ membershipId: candidate.membership_id, membershipType: candidate.membership_type as number }));
    const result = await refreshOpponents(due, { concurrency: 6, deadlineMs: Date.now() + 38_000 });
    return NextResponse.json({ ok: true, candidates: candidates.length, due: due.length, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
