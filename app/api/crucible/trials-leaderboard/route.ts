import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/helpers";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { syncRivalryFriendExclusions } from "@/lib/crucible/rivalryFriends";
import { isPlaceholderPlayerName, loadCanonicalPlayerIdentities } from "@/lib/crucible/playerIdentity";
import { listTrialsStats, needsTrialsStatsFetch, type TrialsStatsDoc } from "@/lib/crucible/trialsStatsStore";
import { refreshOpponents, type OpponentRef } from "@/lib/crucible/trialsBackfill";
import { crucibleGameReportUrl } from "@/lib/crucible/modes";
import type { CrucibleModeBucket, TrialsRival } from "@/lib/crucible/types";

const LIMIT = 15;
const APPWRITE_QUERY_CHUNK = 100;
// On a cache miss, fill in the viewer's most-played uncached opponents inline
// so their own board populates on their own visit rather than waiting for the
// global cron to reach them. Bounded to keep page latency in check (each fetch
// fans out across the account's characters in parallel, ~0.5s apiece at
// concurrency 4).
const INLINE_FETCH_MAX = 10;
// Hard cap on inline fetch latency so a cold board stays responsive.
const INLINE_FETCH_DEADLINE_MS = 9_000;

interface EncounterAggregateRow {
  opponent_membership_id: string;
  opponent_membership_type: number | null;
  opponent_display_name: string;
  encounters: number | string;
  wins: number | string;
  losses: number | string;
  unknown: number | string;
  last_played_at: string;
  last_win_instance_id: string | null;
  last_win_mode: string | null;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

export async function GET() {
  try {
    const session = await requireSession();
    const supabase = createAdminSupabaseClient(5_000);
    await syncRivalryFriendExclusions({
      userId: session.userId,
      viewerMembershipId: session.bungieMembershipId,
      db: supabase,
    }).catch((error) => {
      console.error(
        "[crucible/trials-leaderboard] friend sync failed:",
        error instanceof Error ? error.message : error
      );
    });

    const { data, error } = await supabase.rpc("get_trials_encounter_aggregate", {
      p_viewer_user_id: session.userId,
    });
    if (error) throw new Error(`Trials encounter lookup failed: ${error.message}`);
    const rows = (data ?? []) as EncounterAggregateRow[];
    if (rows.length === 0) return NextResponse.json({ rivals: [] });

    const beatenRows = rows.filter((row) => Number(row.wins) > 0);
    const membershipIds = beatenRows.map((row) => row.opponent_membership_id);
    const trialsStats = new Map<string, TrialsStatsDoc>();
    for (const batch of chunk(membershipIds, APPWRITE_QUERY_CHUNK)) {
      const batchResult = await listTrialsStats(batch);
      for (const [id, doc] of batchResult) trialsStats.set(id, doc);
    }

    // Inline top-up: if the viewer has beaten opponents whose lifetime Trials
    // K/D isn't cached yet, fetch their most-played (by wins) uncached ones now
    // so their board fills in on their own visit rather than only via the cron.
    // Bounded by INLINE_FETCH_MAX to keep latency predictable.
    const needFetch = beatenRows
      .filter((row) => needsTrialsStatsFetch(trialsStats.get(row.opponent_membership_id)))
      .sort((a, b) => Number(b.wins) - Number(a.wins))
      .slice(0, INLINE_FETCH_MAX);
    if (needFetch.length > 0) {
      const missingType = needFetch
        .filter((row) => !row.opponent_membership_type)
        .map((row) => row.opponent_membership_id);
      const fetchIdentities = missingType.length > 0
        ? await loadCanonicalPlayerIdentities(supabase, missingType)
        : new Map();
      const refs: OpponentRef[] = [];
      for (const row of needFetch) {
        const membershipType = row.opponent_membership_type
          ?? fetchIdentities.get(row.opponent_membership_id)?.membership_type;
        if (membershipType) refs.push({ membershipId: row.opponent_membership_id, membershipType });
      }
      if (refs.length > 0) {
        // Cap inline work so a cold board never hangs the page; whatever didn't
        // finish is filled by the background cron or the next visit.
        await refreshOpponents(refs, { concurrency: 4, deadlineMs: Date.now() + INLINE_FETCH_DEADLINE_MS });
        for (const [id, doc] of await listTrialsStats(refs.map((ref) => ref.membershipId))) {
          trialsStats.set(id, doc);
        }
      }
    }

    // beatenRows is already filtered to opponents you've beaten at least once -
    // this is a highlight reel of wins against tough players, not a full ledger.
    const ranked = beatenRows
      .map((row) => ({ row, stats: trialsStats.get(row.opponent_membership_id) }))
      .filter((entry): entry is { row: EncounterAggregateRow; stats: TrialsStatsDoc } =>
        !!entry.stats && entry.stats.trialsActivitiesEntered > 0
      )
      .map(({ row, stats }) => ({
        row,
        stats,
        trialsKd: stats.trialsDeaths > 0 ? stats.trialsKills / stats.trialsDeaths : stats.trialsKills,
      }))
      .sort((a, b) => b.trialsKd - a.trialsKd || Number(b.row.encounters) - Number(a.row.encounters))
      .slice(0, LIMIT);

    const identities = await loadCanonicalPlayerIdentities(
      supabase,
      ranked.map((entry) => entry.row.opponent_membership_id)
    );

    const rivals: TrialsRival[] = ranked.map((entry, index) => {
      const { row, stats, trialsKd } = entry;
      const identity = identities.get(row.opponent_membership_id);
      return {
        rank: index + 1,
        membershipId: row.opponent_membership_id,
        membershipType: !row.opponent_membership_type && identity?.membership_type
          ? identity.membership_type
          : row.opponent_membership_type,
        displayName: isPlaceholderPlayerName(row.opponent_display_name) && identity?.display_name
          ? identity.display_name
          : row.opponent_display_name,
        emblemPath: identity?.emblem_path ?? null,
        encounters: Number(row.encounters),
        wins: Number(row.wins),
        losses: Number(row.losses),
        unknown: Number(row.unknown),
        lastPlayedAt: row.last_played_at,
        trialsKills: stats.trialsKills,
        trialsDeaths: stats.trialsDeaths,
        trialsKd,
        trialsActivitiesEntered: stats.trialsActivitiesEntered,
        matchReportUrl: row.last_win_instance_id
          ? crucibleGameReportUrl(row.last_win_instance_id, row.last_win_mode as CrucibleModeBucket | null)
          : null,
      };
    });

    return NextResponse.json({ rivals });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load Trials leaderboard";
    return NextResponse.json({ error: message }, { status: message === "Unauthorized" ? 401 : 500 });
  }
}
