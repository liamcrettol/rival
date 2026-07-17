import { NextRequest, NextResponse } from "next/server";
import { assertCronAuth } from "@/lib/auth/cron";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { loadCanonicalPlayerIdentities } from "@/lib/crucible/playerIdentity";
import { listTrialsStats, needsTrialsStatsFetch, type TrialsStatsDoc } from "@/lib/crucible/trialsStatsStore";
import { refreshOpponents, type OpponentRef } from "@/lib/crucible/trialsBackfill";

// Background backfill of opponents' lifetime Trials K/D, invoked by Supabase
// pg_cron (migration 010's ping_cron_endpoint, scheduled from migration 019).
// Walks a bounded, K/D-prioritized candidate list (migration 021) so the
// opponents that actually surface on leaderboards get cached first, instead of
// crawling the entire ~73k-opponent universe.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The candidate pool is capped and ordered highest-K/D-first, so this covers
// every opponent that could realistically appear on a board many times over.
const CANDIDATE_POOL = 500;
// Bound the run by wall-clock, not count: leave headroom under maxDuration (60s)
// for the candidate read, cache lookups, and response. Whatever fits, fits.
const RUN_DEADLINE_MS = 38_000;
const MAX_FETCHES_PER_RUN = 150;
const OPPONENT_CONCURRENCY = 6;
const APPWRITE_QUERY_CHUNK = 100;

interface Candidate {
  membership_id: string;
  membership_type: number | null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

export async function GET(req: NextRequest) {
  const denied = assertCronAuth(req);
  if (denied) return denied;

  const startedAt = Date.now();
  // The candidate aggregate scans the full Trials PGCR player history to rank
  // by sampled K/D (~3s), well past the default 1.2s admin-client timeout.
  const supabase = createAdminSupabaseClient(15_000);

  try {
    const { data, error } = await supabase.rpc("get_trials_backfill_candidates", {
      p_limit: CANDIDATE_POOL,
    });
    if (error) throw new Error(`Backfill candidate lookup failed: ${error.message}`);
    const candidates = (data ?? []) as Candidate[];

    const cached = new Map<string, TrialsStatsDoc>();
    for (const batch of chunk(candidates.map((c) => c.membership_id), APPWRITE_QUERY_CHUNK)) {
      for (const [id, doc] of await listTrialsStats(batch)) cached.set(id, doc);
    }

    const due = candidates.filter((c) => needsTrialsStatsFetch(cached.get(c.membership_id)));

    const missingType = due.filter((c) => !c.membership_type).map((c) => c.membership_id);
    const identities = missingType.length > 0
      ? await loadCanonicalPlayerIdentities(supabase, missingType)
      : new Map();

    let skipped = 0;
    const toFetch: OpponentRef[] = [];
    for (const candidate of due) {
      if (toFetch.length >= MAX_FETCHES_PER_RUN) break;
      const membershipType = candidate.membership_type ?? identities.get(candidate.membership_id)?.membership_type;
      if (!membershipType) {
        skipped++;
        continue;
      }
      toFetch.push({ membershipId: candidate.membership_id, membershipType });
    }

    const { updated, failed, remaining } = await refreshOpponents(toFetch, {
      concurrency: OPPONENT_CONCURRENCY,
      deadlineMs: startedAt + RUN_DEADLINE_MS,
    });

    const payload = {
      ok: true,
      candidates: candidates.length,
      due: due.length,
      planned: toFetch.length,
      updated,
      failed,
      // Not reached before the deadline; picked up next run.
      deferred: remaining,
      skipped,
      durationMs: Date.now() - startedAt,
    };
    console.log("[cron/sync-trials-kd] run summary:", payload);
    return NextResponse.json(payload);
  } catch (error) {
    const message = errorMessage(error);
    console.error("[cron/sync-trials-kd] run error:", message);
    return NextResponse.json({ ok: false, error: message, durationMs: Date.now() - startedAt }, { status: 500 });
  }
}
