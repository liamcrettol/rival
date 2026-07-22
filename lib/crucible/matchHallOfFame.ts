import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { isTrialsStatsQuotaError, listTrialsStats, type TrialsStatsDoc } from "@/lib/crucible/trialsStatsStore";
import { crucibleGameReportUrl, crucibleModeName, trialsReportPlayerUrl } from "./modes";
import type { MatchHallOfFameEntry } from "./types";

type Db = any;

interface MatchRow {
  instance_id: string;
  activity_mode: number | null;
  activity_modes: number[] | null;
  mode_bucket: "trials" | "competitive" | "control" | "iron_banner" | "other";
  activity_name: string | null;
  activity_image: string | null;
  period: string;
  team_data: unknown;
  is_private: boolean;
}

interface PlayerRow {
  instance_id: string;
  membership_id: string;
  membership_type: number | null;
  display_name: string;
  team_id: number | null;
  is_win: boolean | null;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
}

function teamScore(teamData: unknown, teamId: number | null): number | null {
  if (teamId === null || !Array.isArray(teamData)) return null;
  const team = teamData.find((value) => value && typeof value === "object" && (value as { teamId?: unknown }).teamId === teamId);
  const score = team && typeof team === "object" ? (team as { score?: unknown }).score : null;
  return typeof score === "number" ? score : null;
}

export async function getMatchHallOfFame(
  userId: string,
  options: { db?: Db; onDegraded?: () => void } = {},
): Promise<MatchHallOfFameEntry[]> {
  // Default adminSupabase has a 1.2s timeout, too short for a full-history scan.
  const db = options.db ?? createAdminSupabaseClient(25_000);
  const { data: account, error: accountError } = await db.from("bungie_accounts")
    .select("membership_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (accountError) throw new Error(`Match hall of fame account lookup failed: ${accountError.message}`);
  if (!account?.membership_id) return [];

  // A count-only query is cheap (index-only scan), unlike reading every
  // encounter/match/player row below. Use it to short-circuit to a cached
  // result when the viewer's history hasn't grown since it was last computed.
  const { count: encounterCount, error: countError } = await db.from("crucible_encounters")
    .select("instance_id", { count: "exact", head: true })
    .eq("viewer_user_id", userId);
  if (countError) throw new Error(`Match hall of fame history count failed: ${countError.message}`);
  if (!encounterCount) return [];

  const { data: cached, error: cacheError } = await db.from("match_hall_of_fame_cache")
    .select("encounter_count, entries")
    .eq("user_id", userId)
    .maybeSingle();
  if (cacheError) throw new Error(`Match hall of fame cache lookup failed: ${cacheError.message}`);
  if (cached && cached.encounter_count === encounterCount) {
    return cached.entries as MatchHallOfFameEntry[];
  }

  // Full history, not just recent games - a legendary win from a year ago is
  // exactly the kind of thing this feature exists to surface, and capping to
  // "most recent" silently excluded most of a prolific player's history
  // (measured 22k+ all-time win matches vs. a 5000-row recency cap). Only
  // reached on a cache miss, i.e. the first visit after new matches synced.
  const { data: encounterRows, error: encounterError } = await db.from("crucible_encounters")
    .select("instance_id")
    .eq("viewer_user_id", userId);
  if (encounterError) throw new Error(`Match hall of fame history lookup failed: ${encounterError.message}`);
  const instanceIds = [...new Set((encounterRows ?? []).map((row: { instance_id: string }) => row.instance_id))];
  if (instanceIds.length === 0) return [];

  const [{ data: matches, error: matchError }, { data: players, error: playerError }] = await Promise.all([
    db.from("crucible_matches")
      .select("instance_id, activity_mode, activity_modes, mode_bucket, activity_name, activity_image, period, team_data, is_private")
      .in("instance_id", instanceIds),
    db.from("crucible_match_players")
      .select("instance_id, membership_id, membership_type, display_name, team_id, is_win, kills, deaths, assists")
      .in("instance_id", instanceIds),
  ]);
  if (matchError) throw new Error(`Match hall of fame match lookup failed: ${matchError.message}`);
  if (playerError) throw new Error(`Match hall of fame roster lookup failed: ${playerError.message}`);

  const playersByMatch = new Map<string, PlayerRow[]>();
  for (const player of (players ?? []) as PlayerRow[]) {
    const rows = playersByMatch.get(player.instance_id) ?? [];
    rows.push(player);
    playersByMatch.set(player.instance_id, rows);
  }

  const entries = ((matches ?? []) as MatchRow[]).flatMap((match) => {
    const rows = playersByMatch.get(match.instance_id) ?? [];
    const viewer = rows.find((row) => row.membership_id === account.membership_id);
    if (!viewer || viewer.team_id === null) return [];
    if (viewer.is_win !== true) return [];
    const team = rows.filter((row) => row.team_id === viewer.team_id);
    if (team.length !== 3) return [];
    const opponents = rows.filter((row) => row.team_id !== null && row.team_id !== viewer.team_id);
    const kills = viewer.kills ?? 0;
    const deaths = viewer.deaths ?? 0;
    const kd = deaths === 0 ? kills : kills / deaths;
    const opponentTeamId = rows.find((row) => row.team_id !== null && row.team_id !== viewer.team_id)?.team_id ?? null;
    const ownScore = teamScore(match.team_data, viewer.team_id);
    const opponentScore = teamScore(match.team_data, opponentTeamId);
    const toPlayer = (player: PlayerRow) => ({
      membershipId: player.membership_id,
      membershipType: player.membership_type,
      displayName: player.display_name,
      kills: player.kills,
      deaths: player.deaths,
      assists: player.assists,
      kd: player.kills === null || player.deaths === null
        ? null
        : player.deaths === 0 ? player.kills : player.kills / player.deaths,
      isCurrentUser: player.membership_id === account.membership_id,
      trialsReportUrl: player.membership_type !== null
        ? trialsReportPlayerUrl(player.membership_type, player.membership_id)
        : null,
    });
    return [{
      instanceId: match.instance_id,
      result: "win" as const,
      kd,
      kills,
      deaths,
      assists: viewer.assists ?? 0,
      team: team.map(toPlayer).sort((a, b) => (b.kills ?? -1) - (a.kills ?? -1)),
      opponents: opponents.map(toPlayer).sort((a, b) => (b.kills ?? -1) - (a.kills ?? -1)),
      candidateOpponents: opponents
        .filter((opponent) => opponent.membership_type !== null)
        .map((opponent) => ({
          membershipId: opponent.membership_id,
          membershipType: opponent.membership_type as number,
          displayName: opponent.display_name,
          kills: opponent.kills ?? 0,
          deaths: opponent.deaths ?? 0,
        })),
      teamScore: ownScore,
      opponentScore,
      mapImage: match.activity_image,
      mode: crucibleModeName({ activityMode: match.activity_mode, activityModes: match.activity_modes ?? [], modeBucket: match.mode_bucket }),
      map: match.activity_name ?? "Unknown map",
      playedAt: match.period,
      score: ownScore !== null && opponentScore !== null ? `${ownScore}-${opponentScore}` : null,
      matchReportUrl: crucibleGameReportUrl(match.instance_id, match.mode_bucket),
    }];
  });

  // Aggregate each opponent's own kills/deaths across every appearance in your
  // win history (data we already have, no Bungie call needed) as a cheap proxy
  // for how likely they are to actually clear the lifetime K/D bar. A viewer
  // can easily have thousands of unique opponents (8700+ observed for a single
  // active user) - fetching an arbitrary/unordered slice of "missing" ones
  // means most inline top-ups are wasted on opponents who were never going to
  // qualify. Prioritizing by sample K/D spends the scarce per-request Bungie
  // budget on the opponents most likely to actually surface a match.
  const sampleTotals = new Map<string, { kills: number; deaths: number }>();
  for (const ref of entries.flatMap((entry) => entry.candidateOpponents)) {
    const totals = sampleTotals.get(ref.membershipId) ?? { kills: 0, deaths: 0 };
    totals.kills += ref.kills;
    totals.deaths += ref.deaths;
    sampleTotals.set(ref.membershipId, totals);
  }
  const sampleKd = (membershipId: string): number => {
    const totals = sampleTotals.get(membershipId);
    if (!totals) return 0;
    return totals.deaths > 0 ? totals.kills / totals.deaths : totals.kills;
  };

  const refs = [...new Map(entries.flatMap((entry) => entry.candidateOpponents).map((ref) => [ref.membershipId, ref])).values()];
  // Appwrite bills each document read. A prolific player can have thousands
  // of unique opponents, so querying every ID here exhausted the monthly
  // database-read allowance and made the page fail. The cron backfill already
  // refreshes missing stats; the request only reads the 250 most promising
  // cached candidates and never performs a write-side backfill.
  const prioritizedRefs = refs
    .sort((a, b) => sampleKd(b.membershipId) - sampleKd(a.membershipId))
    .slice(0, 250);
  let cachedStats: Map<string, TrialsStatsDoc>;
  try {
    cachedStats = await listTrialsStats(prioritizedRefs.map((ref) => ref.membershipId));
  } catch (error) {
    if (!isTrialsStatsQuotaError(error)) throw error;
    console.warn("[match-hall-of-fame] Trials stats read quota exhausted; serving cached result", {
      userId,
      candidateCount: prioritizedRefs.length,
    });
    options.onDegraded?.();
    const staleEntries = cached?.entries as MatchHallOfFameEntry[] | undefined;
    if (staleEntries) {
      // Bump the cache's encounter_count to the freshly computed value so
      // repeat visits during an Appwrite outage hit the cache fast-path
      // instead of re-running this full scan (and re-hitting the exhausted
      // quota) on every request. The entries themselves stay stale until the
      // next run that succeeds. Skipped when there's no prior cached result
      // to fall back to, so a brand-new user isn't stuck with an empty
      // result until their encounter count changes again.
      const { error: degradedUpsertError } = await db.from("match_hall_of_fame_cache")
        .upsert({ user_id: userId, encounter_count: encounterCount, entries: staleEntries, computed_at: new Date().toISOString() });
      if (degradedUpsertError) console.error(`Match hall of fame degraded cache bump failed: ${degradedUpsertError.message}`);
    }
    return staleEntries ?? [];
  }
  const lifetimeStats = new Map<string, number>();
  for (const ref of refs) {
    const stats = cachedStats.get(ref.membershipId);
    if (stats && stats.trialsActivitiesEntered > 0) lifetimeStats.set(ref.membershipId, stats.trialsDeaths === 0 ? stats.trialsKills : stats.trialsKills / stats.trialsDeaths);
  }

  const result = entries.flatMap((entry) => {
    const qualifyingOpponent = entry.candidateOpponents
      .map((opponent) => ({ ...opponent, kd: lifetimeStats.get(opponent.membershipId) ?? 0 }))
      .filter((opponent) => opponent.kd >= 1.5)
      .sort((a, b) => b.kd - a.kd)[0];
    if (!qualifyingOpponent) return [];
    const { candidateOpponents: _candidateOpponents, ...match } = entry;
    return [{
      ...match,
      opponentName: qualifyingOpponent.displayName,
      opponentKd: qualifyingOpponent.kd,
      opponentTrialsReportUrl: trialsReportPlayerUrl(qualifyingOpponent.membershipType, qualifyingOpponent.membershipId),
    } satisfies Omit<MatchHallOfFameEntry, "rank">];
  })
    .sort((a, b) => b.kd - a.kd || b.kills - a.kills || new Date(b.playedAt).getTime() - new Date(a.playedAt).getTime())
    .slice(0, 10)
    .map((entry, index) => ({ ...entry, rank: index + 1 }));

  // Best-effort: a failed cache write shouldn't fail a request that already
  // has a good result to return.
  const { error: upsertError } = await db.from("match_hall_of_fame_cache")
    .upsert({ user_id: userId, encounter_count: encounterCount, entries: result, computed_at: new Date().toISOString() });
  if (upsertError) console.error(`Match hall of fame cache write failed: ${upsertError.message}`);

  return result;
}
