import { fetchLifetimeTrialsStats } from "@/lib/bungie/trialsStats";
import { recordTrialsStatsFetchFailure, upsertTrialsStats } from "@/lib/crucible/trialsStatsStore";

export interface OpponentRef {
  membershipId: string;
  membershipType: number;
}

export interface RefreshOutcome {
  updated: number;
  failed: number;
  /** Opponents left unprocessed because the deadline hit first. */
  remaining: number;
}

// Fetch one opponent's lifetime Trials stats and cache the result. A failure
// stamps the cache with the error (so the staleness policy backs off instead
// of hammering a private/deleted account every run) without overwriting any
// previously-good numbers. Never throws - the outcome is returned so a pool
// can keep going.
async function refreshOne(opponent: OpponentRef): Promise<"updated" | "failed"> {
  try {
    const stats = await fetchLifetimeTrialsStats(opponent.membershipType, opponent.membershipId);
    await upsertTrialsStats({
      membershipId: opponent.membershipId,
      membershipType: opponent.membershipType,
      trialsKills: stats?.kills ?? 0,
      trialsDeaths: stats?.deaths ?? 0,
      trialsActivitiesEntered: stats?.activitiesEntered ?? 0,
      charactersChecked: stats?.charactersChecked ?? 0,
      lastError: null,
    });
    return "updated";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordTrialsStatsFetchFailure(opponent.membershipId, opponent.membershipType, message).catch(() => {});
    return "failed";
  }
}

// Refresh a batch of opponents with bounded concurrency, stopping cleanly at an
// optional wall-clock deadline. Each opponent fetch itself fans out across that
// account's characters in parallel (see fetchLifetimeTrialsStats), so keep the
// outer concurrency modest: this shares one throttled Bungie API key with the
// rest of the app, and concurrency N here means up to ~N*9 in-flight Bungie
// requests. The deadline is what actually bounds a run - the per-opponent cost
// varies, so callers cap by time (fit inside Vercel's maxDuration / keep page
// latency sane) rather than guessing a safe count. Used by both the background
// cron (large batch, long deadline) and the leaderboard route (small inline
// top-up, short deadline).
export async function refreshOpponents(
  opponents: OpponentRef[],
  { concurrency = 4, deadlineMs }: { concurrency?: number; deadlineMs?: number } = {}
): Promise<RefreshOutcome> {
  let cursor = 0;
  let updated = 0;
  let failed = 0;

  async function worker() {
    while (cursor < opponents.length && (deadlineMs === undefined || Date.now() < deadlineMs)) {
      const opponent = opponents[cursor++];
      const outcome = await refreshOne(opponent);
      if (outcome === "updated") updated++;
      else failed++;
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, opponents.length) }, () => worker())
  );

  return { updated, failed, remaining: opponents.length - updated - failed };
}
