import { bungieGet } from "@/lib/bungie/client";

const TRIALS_MODE = 84;

interface AccountCharacterSummary { characterId: string; }
interface AccountStatsResponse { characters?: AccountCharacterSummary[]; }
interface TrialsStatValue { basic?: { value?: number }; }
interface CharacterTrialsStatsResponse {
  trials_of_osiris?: { allTime?: { kills?: TrialsStatValue; deaths?: TrialsStatValue; activitiesEntered?: TrialsStatValue } };
}

export interface LifetimeTrialsStats {
  kills: number;
  deaths: number;
  activitiesEntered: number;
}

export async function fetchLifetimeTrialsStats(membershipType: number, membershipId: string): Promise<LifetimeTrialsStats | null> {
  const account = await bungieGet<AccountStatsResponse>(`/Destiny2/${membershipType}/Account/${membershipId}/Stats/?groups=General`, "");
  const characters = account.characters ?? [];
  if (characters.length === 0) return null;
  const stats = await Promise.all(characters.map((character) => bungieGet<CharacterTrialsStatsResponse>(
    `/Destiny2/${membershipType}/Account/${membershipId}/Character/${character.characterId}/Stats/?groups=General&modes=${TRIALS_MODE}`,
    "",
  )));
  return stats.reduce((total, response) => {
    const allTime = response.trials_of_osiris?.allTime;
    if (!allTime) return total;
    total.kills += allTime.kills?.basic?.value ?? 0;
    total.deaths += allTime.deaths?.basic?.value ?? 0;
    total.activitiesEntered += allTime.activitiesEntered?.basic?.value ?? 0;
    return total;
  }, { kills: 0, deaths: 0, activitiesEntered: 0 });
}
