import { adminSupabase } from "@/lib/supabase/admin";
import { crucibleGameReportUrl, crucibleModeName } from "./modes";
import type { MatchHallOfFameEntry } from "./types";

type Db = any;

interface MatchRow {
  instance_id: string;
  activity_mode: number | null;
  activity_modes: number[] | null;
  mode_bucket: "trials" | "competitive" | "control" | "iron_banner" | "other";
  activity_name: string | null;
  period: string;
  team_data: unknown;
  is_private: boolean;
}

interface PlayerRow {
  instance_id: string;
  membership_id: string;
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
      .select("instance_id, activity_mode, activity_modes, mode_bucket, activity_name, period, team_data, is_private")
      .in("instance_id", instanceIds)
      .eq("is_private", false),
    db.from("crucible_match_players")
      .select("instance_id, membership_id, team_id, is_win, kills, deaths, assists")
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
    const team = rows.filter((row) => row.team_id === viewer.team_id);
    if (team.length !== 3 || viewer.kills === null || viewer.deaths === null) return [];
    const kills = viewer.kills;
    const deaths = viewer.deaths;
    const kd = deaths === 0 ? kills : kills / deaths;
    if (kills < 5 || kd < 1.75) return [];
    const opponentTeamId = rows.find((row) => row.team_id !== null && row.team_id !== viewer.team_id)?.team_id ?? null;
    const ownScore = teamScore(match.team_data, viewer.team_id);
    const opponentScore = teamScore(match.team_data, opponentTeamId);
    return [{
      instanceId: match.instance_id,
      result: viewer.is_win === true ? "win" : viewer.is_win === false ? "loss" : "unknown",
      kd,
      kills,
      deaths,
      assists: viewer.assists ?? 0,
      mode: crucibleModeName({ activityMode: match.activity_mode, activityModes: match.activity_modes ?? [], modeBucket: match.mode_bucket }),
      map: match.activity_name ?? "Unknown map",
      playedAt: match.period,
      score: ownScore !== null && opponentScore !== null ? `${ownScore}-${opponentScore}` : null,
      matchReportUrl: crucibleGameReportUrl(match.instance_id, match.mode_bucket),
    } satisfies Omit<MatchHallOfFameEntry, "rank">];
  });

  return entries
    .sort((a, b) => b.kd - a.kd || b.kills - a.kills || new Date(b.playedAt).getTime() - new Date(a.playedAt).getTime())
    .slice(0, 10)
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}
