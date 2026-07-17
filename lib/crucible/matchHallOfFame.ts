import { adminSupabase } from "@/lib/supabase/admin";
import { listTrialsStats } from "@/lib/crucible/trialsStatsStore";
import { refreshOpponents } from "@/lib/crucible/trialsBackfill";
import { crucibleGameReportUrl, crucibleModeName } from "./modes";
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
  options: { db?: Db } = {},
): Promise<MatchHallOfFameEntry[]> {
  const db = options.db ?? adminSupabase;
  const { data: account, error: accountError } = await db.from("bungie_accounts")
    .select("membership_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (accountError) throw new Error(`Match hall of fame account lookup failed: ${accountError.message}`);
  if (!account?.membership_id) return [];

  const { data: encounterRows, error: encounterError } = await db.from("crucible_encounters")
    .select("instance_id, played_at")
    .eq("viewer_user_id", userId)
    .order("played_at", { ascending: false })
    .limit(5000);
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
      displayName: player.display_name,
      kills: player.kills,
      deaths: player.deaths,
      assists: player.assists,
      kd: player.kills === null || player.deaths === null
        ? null
        : player.deaths === 0 ? player.kills : player.kills / player.deaths,
      isCurrentUser: player.membership_id === account.membership_id,
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
        .map((opponent) => ({ membershipId: opponent.membership_id, membershipType: opponent.membership_type as number, displayName: opponent.display_name })),
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

  const refs = [...new Map(entries.flatMap((entry) => entry.candidateOpponents).map((ref) => [ref.membershipId, ref])).values()];
  let cachedStats = await listTrialsStats(refs.map((ref) => ref.membershipId));
  const missingRefs = refs.filter((ref) => !cachedStats.has(ref.membershipId)).slice(0, 100);
  if (missingRefs.length > 0) {
    await refreshOpponents(missingRefs, { concurrency: 4, deadlineMs: Date.now() + 25_000 });
    cachedStats = await listTrialsStats(refs.map((ref) => ref.membershipId));
  }
  const lifetimeStats = new Map<string, number>();
  for (const ref of refs) {
    const stats = cachedStats.get(ref.membershipId);
    if (stats && stats.trialsActivitiesEntered > 0) lifetimeStats.set(ref.membershipId, stats.trialsDeaths === 0 ? stats.trialsKills : stats.trialsKills / stats.trialsDeaths);
  }

  return entries.flatMap((entry) => {
    const qualifyingOpponent = entry.candidateOpponents
      .map((opponent) => ({ ...opponent, kd: lifetimeStats.get(opponent.membershipId) ?? 0 }))
      .filter((opponent) => opponent.kd >= 1.5)
      .sort((a, b) => b.kd - a.kd)[0];
    if (!qualifyingOpponent) return [];
    const { candidateOpponents: _candidateOpponents, ...match } = entry;
    return [{ ...match, opponentName: qualifyingOpponent.displayName, opponentKd: qualifyingOpponent.kd } satisfies Omit<MatchHallOfFameEntry, "rank">];
  })
    .sort((a, b) => b.kd - a.kd || b.kills - a.kills || new Date(b.playedAt).getTime() - new Date(a.playedAt).getTime())
    .slice(0, 10)
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}
