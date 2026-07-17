import { NextRequest, NextResponse } from "next/server";
import { assertCronAuth } from "@/lib/auth/cron";
import { adminSupabase } from "@/lib/supabase/admin";
import { loadCanonicalPlayerIdentities } from "@/lib/crucible/playerIdentity";
import { fetchLifetimeTrialsStats } from "@/lib/bungie/trialsStats";
import {
  listTrialsStats,
  needsTrialsStatsFetch,
  recordTrialsStatsFetchFailure,
  upsertTrialsStats,
  type TrialsStatsDoc,
} from "@/lib/crucible/trialsStatsStore";

// Background backfill of opponents' lifetime Trials K/D, invoked by Supabase
// pg_cron (same wiring as sync-crucible: migration 010's ping_cron_endpoint,
// scheduled from migration 019). Time-budgeted like sync-crucible so a slow
// run degrades gracefully instead of hitting Vercel's ceiling.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CANDIDATE_POOL = 200;
const MAX_FETCHES_PER_RUN = 30;
const TIME_BUDGET_MS = 45_000;
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
  let checked = 0;
  let updated = 0;
  let skipped = 0;
  const failures: Array<{ membershipId: string; error: string }> = [];

  try {
    const { data, error } = await adminSupabase.rpc("get_distinct_trials_opponents", {
      p_limit: CANDIDATE_POOL,
    });
    if (error) throw new Error(`Backfill candidate lookup failed: ${error.message}`);
    const candidates = (data ?? []) as Candidate[];

    const cached = new Map<string, TrialsStatsDoc>();
    for (const batch of chunk(candidates.map((c) => c.membership_id), APPWRITE_QUERY_CHUNK)) {
      const batchResult = await listTrialsStats(batch);
      for (const [id, doc] of batchResult) cached.set(id, doc);
    }

    const due = candidates.filter((c) => needsTrialsStatsFetch(cached.get(c.membership_id)));

    const missingType = due.filter((c) => !c.membership_type).map((c) => c.membership_id);
    const identities = missingType.length > 0
      ? await loadCanonicalPlayerIdentities(adminSupabase, missingType)
      : new Map();

    for (const candidate of due) {
      if (checked >= MAX_FETCHES_PER_RUN || Date.now() - startedAt > TIME_BUDGET_MS) break;
      const membershipType = candidate.membership_type ?? identities.get(candidate.membership_id)?.membership_type;
      if (!membershipType) {
        skipped++;
        continue;
      }
      checked++;
      try {
        const stats = await fetchLifetimeTrialsStats(membershipType, candidate.membership_id);
        await upsertTrialsStats({
          membershipId: candidate.membership_id,
          membershipType,
          trialsKills: stats?.kills ?? 0,
          trialsDeaths: stats?.deaths ?? 0,
          trialsActivitiesEntered: stats?.activitiesEntered ?? 0,
          charactersChecked: stats?.charactersChecked ?? 0,
          lastError: null,
        });
        updated++;
      } catch (fetchError) {
        const message = errorMessage(fetchError);
        failures.push({ membershipId: candidate.membership_id, error: message });
        await recordTrialsStatsFetchFailure(candidate.membership_id, membershipType, message).catch(() => {});
      }
    }

    const payload = {
      ok: true,
      candidates: candidates.length,
      due: due.length,
      checked,
      updated,
      skipped,
      failures,
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
