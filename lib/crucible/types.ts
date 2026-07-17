export type CrucibleModeBucket =
  | "trials"
  | "competitive"
  | "control"
  | "iron_banner"
  | "other";

export const CRUCIBLE_MODE_BUCKETS: CrucibleModeBucket[] = [
  "trials",
  "competitive",
  "control",
  "iron_banner",
  "other",
];

export interface HeadToHeadModeRecord {
  encounters: number;
  wins: number;
  losses: number;
  unknown: number;
}

export interface HeadToHeadMeeting {
  instanceId: string;
  playedAt: string;
  mode: CrucibleModeBucket;
  modeName: string;
  viewerWon: boolean | null;
  activityName: string | null;
}

export interface HeadToHeadSummary extends HeadToHeadModeRecord {
  opponentMembershipId: string;
  opponentMembershipType: number | null;
  opponentDisplayName: string;
  lastPlayedAt: string | null;
  byMode: Partial<Record<CrucibleModeBucket, HeadToHeadModeRecord>>;
  recentMeetings: HeadToHeadMeeting[];
}

export interface OpponentSearchResult {
  membershipId: string;
  membershipType: number | null;
  displayName: string;
  platformDisplayName: string | null;
  emblemPath: string | null;
  source: "history" | "bungie";
  hasHistory: boolean;
  summary: HeadToHeadSummary | null;
}

export interface RivalryLeader {
  rank: number;
  membershipId: string;
  membershipType: number | null;
  displayName: string;
  emblemPath: string | null;
  encounters: number;
  wins: number;
  losses: number;
  unknown: number;
  lastPlayedAt: string;
}

export interface TrialsRival {
  rank: number;
  membershipId: string;
  membershipType: number | null;
  displayName: string;
  emblemPath: string | null;
  encounters: number;
  wins: number;
  losses: number;
  unknown: number;
  lastPlayedAt: string;
  trialsKills: number;
  trialsDeaths: number;
  trialsKd: number;
  trialsActivitiesEntered: number;
  matchReportUrl: string | null;
}

export interface CrucibleSyncState {
  user_id: string;
  status: "queued" | "syncing" | "complete" | "failed";
  next_page: number;
  character_ids: unknown;
  active_character_index: number;
  sync_started_at: string | null;
  last_incremental_sync_at: string | null;
  backfill_completed_at: string | null;
  known_matches_materialized_at: string | null;
  locked_by: string | null;
  locked_until: string | null;
  last_error: string | null;
  attempts: number;
  requested_at: string;
  updated_at: string;
}
