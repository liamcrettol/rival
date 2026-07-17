import { bungieGet } from "@/lib/bungie/client";

const TRIALS_MODE = 84; // DestinyActivityModeType.TrialsOfOsiris

interface AccountCharacterSummary {
  characterId: string;
  deleted?: boolean;
}

interface AccountStatsResponse {
  characters?: AccountCharacterSummary[];
}

interface TrialsStatValue {
  basic?: { value?: number };
}

interface CharacterTrialsStatsResponse {
  trials_of_osiris?: {
    allTime?: {
      kills?: TrialsStatValue;
      deaths?: TrialsStatValue;
      activitiesEntered?: TrialsStatValue;
    };
  };
}

export interface LifetimeTrialsStats {
  kills: number;
  deaths: number;
  activitiesEntered: number;
  charactersChecked: number;
}

// Bungie's account-wide Stats endpoint only breaks results out by top-level
// PvE/PvP groups; a `modes` filter on it is silently ignored (verified against
// the live API). Per-mode breakdowns only exist on the per-character stats
// endpoint, so a lifetime Trials K/D means listing every character on the
// account (including deleted ones, which still carry their historical stats)
// and summing each one's trials_of_osiris block. No OAuth token is required
// for either endpoint, so this passes an empty token through bungieGet to
// reuse its existing retry/throttle handling.
export async function fetchLifetimeTrialsStats(
  membershipType: number,
  membershipId: string
): Promise<LifetimeTrialsStats | null> {
  const account = await bungieGet<AccountStatsResponse>(
    `/Destiny2/${membershipType}/Account/${membershipId}/Stats/?groups=General`,
    ""
  );
  const characters = account.characters ?? [];
  if (characters.length === 0) return null;

  let kills = 0;
  let deaths = 0;
  let activitiesEntered = 0;
  let charactersChecked = 0;

  for (const character of characters) {
    const stats = await bungieGet<CharacterTrialsStatsResponse>(
      `/Destiny2/${membershipType}/Account/${membershipId}/Character/${character.characterId}/Stats/?groups=General&modes=${TRIALS_MODE}`,
      ""
    );
    const allTime = stats.trials_of_osiris?.allTime;
    if (!allTime) continue;
    kills += allTime.kills?.basic?.value ?? 0;
    deaths += allTime.deaths?.basic?.value ?? 0;
    activitiesEntered += allTime.activitiesEntered?.basic?.value ?? 0;
    charactersChecked++;
  }

  return { kills, deaths, activitiesEntered, charactersChecked };
}
