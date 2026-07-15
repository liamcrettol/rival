import { adminSupabase } from "@/lib/supabase/admin";
import { parsePgcr } from "@/lib/pgcr/parse";
import { classifyCrucibleMode } from "./modes";

// Supabase's generated schema is intentionally not checked into this project.
// Keep the dependency structural so importer tests can use a tiny fake DB.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function rawIsPrivate(raw: unknown): boolean {
  const wrapped = asRecord(raw);
  const pgcr = asRecord(wrapped?.Response) ?? wrapped;
  const details = asRecord(pgcr?.activityDetails);
  return details?.isPrivate === true;
}

export interface CrucibleMatchSource {
  pgcr: Extract<ReturnType<typeof parsePgcr>, { kind: "pvp" }>;
  modeBucket: ReturnType<typeof classifyCrucibleMode>;
  matchRow: Record<string, unknown>;
  playerRows: Array<Record<string, unknown>>;
}

export function buildCrucibleMatchSource(input: {
  rawPgcr: unknown;
  activityName?: string | null;
  activityImage?: string | null;
  activityDefModes?: number[];
  directorActivityName?: string | null;
  directorActivityDefModes?: number[];
  now?: string;
}): CrucibleMatchSource | null {
  const parsed = parsePgcr(input.rawPgcr);
  if (!parsed.isSupported || parsed.kind !== "pvp" || !parsed.instanceId || !parsed.period) {
    return null;
  }

  const pgcr = parsed as Extract<ReturnType<typeof parsePgcr>, { kind: "pvp" }>;
  const activityModes = [...new Set([
    ...pgcr.activityModes,
    ...(input.activityDefModes ?? []),
    ...(input.directorActivityDefModes ?? []),
  ])];
  const modeBucket = classifyCrucibleMode({
    activityMode: pgcr.activityMode,
    activityModes,
    activityHash: pgcr.activityHash,
    activityName: input.activityName,
    directorActivityName: input.directorActivityName,
  });
  const now = input.now ?? new Date().toISOString();

  return {
    pgcr,
    modeBucket,
    matchRow: {
      instance_id: pgcr.instanceId,
      activity_hash: pgcr.activityHash,
      director_activity_hash: pgcr.directorActivityHash,
      activity_mode: pgcr.activityMode,
      activity_modes: activityModes,
      mode_bucket: modeBucket,
      activity_name: input.activityName ?? null,
      activity_image: input.activityImage ?? null,
      period: pgcr.period,
      duration_seconds: pgcr.durationSeconds,
      is_private: rawIsPrivate(input.rawPgcr),
      team_data: pgcr.teams,
      updated_at: now,
    },
    playerRows: pgcr.players.map((player) => ({
      instance_id: pgcr.instanceId,
      membership_id: player.membershipId,
      membership_type: player.membershipType,
      display_name: player.displayName ?? "Guardian",
      emblem_path: player.emblemPath ?? null,
      team_id: player.team,
      is_win: player.isWin,
      completed: player.completed,
      kills: player.kills,
      deaths: player.deaths,
      assists: player.assists,
      score: player.score,
      updated_at: now,
    })),
  };
}

export async function upsertCrucibleMatchSource(source: CrucibleMatchSource, db: Db = adminSupabase): Promise<void> {
  const matchRow = { ...source.matchRow };
  let matchResult = await db.from("crucible_matches").upsert(matchRow, { onConflict: "instance_id" });
  if (matchResult?.error) {
    const message = String(matchResult.error.message ?? matchResult.error);
    if (/director_activity_hash/.test(message)) delete matchRow.director_activity_hash;
    if (/activity_image/.test(message)) delete matchRow.activity_image;
    if (/director_activity_hash|activity_image/.test(message)) {
      matchResult = await db.from("crucible_matches").upsert(matchRow, { onConflict: "instance_id" });
    }
  }
  requireNoError(matchResult, "match upsert");
  requireNoError(await db.from("crucible_match_players").upsert(source.playerRows, {
    onConflict: "instance_id,membership_id",
  }), "player upsert");
}

function requireNoError(result: { error?: unknown } | null | undefined, operation: string) {
  if (result?.error) throw new Error(`${operation} failed: ${String(result.error)}`);
}

export async function importCrucibleMatch(input: {
  viewerUserId: string;
  viewerMembershipId: string;
  rawPgcr: unknown;
  activityName?: string | null;
  activityImage?: string | null;
  /** Authoritative mode types from the activity definition, merged into classification. */
  activityDefModes?: number[];
  directorActivityName?: string | null;
  directorActivityDefModes?: number[];
  db?: Db;
}): Promise<{ imported: boolean; encounterCount: number }> {
  const db = input.db ?? adminSupabase;
  const source = buildCrucibleMatchSource(input);
  if (!source) {
    return { imported: false, encounterCount: 0 };
  }
  const { pgcr, modeBucket } = source;

  const viewer = pgcr.players.find((player) => player.membershipId === input.viewerMembershipId);
  if (!viewer) return { imported: false, encounterCount: 0 };
  await upsertCrucibleMatchSource(source, db);

  const markViewerImported = async () => requireNoError(
    await db.from("crucible_match_viewers").upsert({
      viewer_user_id: input.viewerUserId,
      viewer_membership_id: input.viewerMembershipId,
      instance_id: pgcr.instanceId,
      played_at: pgcr.period,
    }, { onConflict: "viewer_user_id,instance_id" }),
    "viewer match upsert",
  );

  // Free-for-all and malformed reports do not expose a trustworthy opponent
  // boundary. Keep their source rows, but never invent head-to-head records.
  if (viewer.team === null) {
    await markViewerImported();
    return { imported: true, encounterCount: 0 };
  }
  const opponents = pgcr.players.filter(
    (player) => player.team !== null && player.team !== viewer.team,
  );
  if (opponents.length === 0) {
    await markViewerImported();
    return { imported: true, encounterCount: 0 };
  }

  const encounters = opponents.map((opponent) => ({
    viewer_user_id: input.viewerUserId,
    viewer_membership_id: input.viewerMembershipId,
    opponent_membership_id: opponent.membershipId,
    opponent_membership_type: opponent.membershipType,
    opponent_display_name: opponent.displayName ?? "Guardian",
    instance_id: pgcr.instanceId,
    mode_bucket: modeBucket,
    viewer_won: viewer.isWin,
    played_at: pgcr.period,
  }));
  requireNoError(await db.from("crucible_encounters").upsert(encounters, {
    onConflict: "viewer_user_id,opponent_membership_id,instance_id",
  }), "encounter upsert");
  await markViewerImported();

  return { imported: true, encounterCount: encounters.length };
}
