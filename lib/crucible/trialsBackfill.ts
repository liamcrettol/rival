import { fetchLifetimeTrialsStats } from "@/lib/bungie/trialsStats";
import { recordTrialsStatsFetchFailure, upsertTrialsStats } from "@/lib/crucible/trialsStatsStore";

export interface OpponentRef { membershipId: string; membershipType: number; }

async function refreshOne(opponent: OpponentRef): Promise<boolean> {
  try {
    const stats = await fetchLifetimeTrialsStats(opponent.membershipType, opponent.membershipId);
    await upsertTrialsStats({ membershipId: opponent.membershipId, membershipType: opponent.membershipType, trialsKills: stats?.kills ?? 0, trialsDeaths: stats?.deaths ?? 0, trialsActivitiesEntered: stats?.activitiesEntered ?? 0, charactersChecked: 0, lastError: null });
    return true;
  } catch (error) {
    await recordTrialsStatsFetchFailure(opponent.membershipId, opponent.membershipType, error instanceof Error ? error.message : String(error)).catch(() => {});
    return false;
  }
}

export async function refreshOpponents(opponents: OpponentRef[], options: { concurrency?: number; deadlineMs?: number } = {}) {
  let cursor = 0; let updated = 0; let failed = 0;
  async function worker() {
    while (cursor < opponents.length && (!options.deadlineMs || Date.now() < options.deadlineMs)) {
      const opponent = opponents[cursor++];
      if (await refreshOne(opponent)) updated++; else failed++;
    }
  }
  await Promise.all(Array.from({ length: Math.min(options.concurrency ?? 4, opponents.length) }, worker));
  return { updated, failed, remaining: opponents.length - updated - failed };
}
