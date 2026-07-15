// Match report types, ported from Rerolled's platform types (#237/#250).
// SeasonMatch is the shape MatchHistoryPanel renders; getCrucibleMatchHistory
// produces it from imported Crucible matches. The `mode`/`rerolledMode`/
// `challengeTitle`/`loadout` fields exist for cross-site enrichment (a match
// that was played as a Rerolled roulette/draft run) and are empty in Rival
// until that lookup is built.

export interface SeasonMatchPlayer {
  membershipId: string;
  membershipType: number | null;
  displayName: string;
  emblemPath: string | null;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  kd: number | null;
  isCurrentUser: boolean;
  isOnViewerTeam: boolean;
  trialsReportUrl: string | null;
  headToHead?: import("@/lib/crucible/types").HeadToHeadSummary | null;
}

export interface SeasonMatchLoadoutSlot {
  slot: "kinetic" | "energy" | "power";
  name: string;
  icon: string | null;
}

export interface SeasonMatch {
  runId: string;
  instanceId?: string | null;
  mode: "score_attack" | "weekly_challenge" | "crucible";
  modeBucket?: import("@/lib/crucible/types").CrucibleModeBucket | null;
  /** Specific game-type label for the card (e.g. "Competitive", "Clash", "Rumble"). */
  modeName?: string | null;
  /** Activity pgcrImage (map banner) when known. */
  mapImage?: string | null;
  /** Rerolled mode that produced this PGCR. Omitted for ordinary Destiny matches. */
  rerolledMode?: "draft" | "loadout_roulette" | null;
  playedAt: string;
  result: "win" | "loss" | "unknown";
  activityName: string;
  challengeTitle: string | null;
  featuredPlayer: SeasonMatchPlayer | null;
  featuredPlayerLabel: string | null;
  teamLabel: string;
  opponentLabel: string | null;
  teamScore: number | null;
  opponentScore: number | null;
  team: SeasonMatchPlayer[];
  opponents: SeasonMatchPlayer[];
  loadout: SeasonMatchLoadoutSlot[];
}
