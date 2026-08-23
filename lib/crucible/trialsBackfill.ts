import { fetchLifetimeTrialsStats } from "@/lib/bungie/trialsStats";
import { recordTrialsStatsFetchFailure, upsertTrialsStats, isTrialsStatsQuotaError } from "@/lib/crucible/trialsStatsStore";

export interface OpponentRef { membershipId: string; membershipType: number; }

type RefreshOutcome = "updated" | "failed" | "quota_exhausted";

async function refreshOne(opponent: OpponentRef): Promise<RefreshOutcome> {
  try {
    const stats = await fetchLifetimeTrialsStats(opponent.membershipType, opponent.membershipId);
    try {
      await upsertTrialsStats({ membershipId: opponent.membershipId, membershipType: opponent.membershipType, trialsKills: stats?.kills ?? 0, trialsDeaths: stats?.deaths ?? 0, trialsActivitiesEntered: stats?.activitiesEntered ?? 0, charactersChecked: 0, lastError: null });
      return "updated";
    } catch (writeError) {
      // Appwrite write quota exhausted independent of the read quota: the
      // Bungie fetch above already succeeded, so there's nothing to retry
      // here, but recording the failure would just be another doomed write.
      // Signal the caller to stop burning Bungie budget on the rest of the
      // batch instead of retrying every "due" candidate every 15 minutes.
      if (isTrialsStatsQuotaError(writeError)) return "quota_exhausted";
      throw writeError;
    }
  } catch (error) {
    await recordTrialsStatsFetchFailure(opponent.membershipId, opponent.membershipType, error instanceof Error ? error.message : String(error)).catch(() => {});
    return "failed";
  }
}

export async function refreshOpponents(opponents: OpponentRef[], options: { concurrency?: number; deadlineMs?: number } = {}) {
  let cursor = 0; let updated = 0; let failed = 0; let quotaExhausted = false;
  async function worker() {
    while (cursor < opponents.length && !quotaExhausted && (!options.deadlineMs || Date.now() < options.deadlineMs)) {
      const opponent = opponents[cursor++];
      const outcome = await refreshOne(opponent);
      if (outcome === "updated") updated++;
      else if (outcome === "failed") failed++;
      else quotaExhausted = true;
    }
  }
  await Promise.all(Array.from({ length: Math.min(options.concurrency ?? 4, opponents.length) }, worker));
  return { updated, failed, remaining: opponents.length - updated - failed, quotaExhausted };
}
