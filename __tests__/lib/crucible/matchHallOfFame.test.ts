/** @jest-environment node */
jest.mock("@/lib/crucible/trialsStatsStore", () => ({
  isTrialsStatsQuotaError: jest.fn(),
  listTrialsStats: jest.fn(),
}));

import { getMatchHallOfFame } from "@/lib/crucible/matchHallOfFame";
import { isTrialsStatsQuotaError, listTrialsStats } from "@/lib/crucible/trialsStatsStore";

const mockIsQuotaError = isTrialsStatsQuotaError as jest.Mock;
const mockListTrialsStats = listTrialsStats as jest.Mock;

const STALE_ENTRIES = [
  { rank: 1, instanceId: "old-match", result: "win", kd: 3, kills: 9, deaths: 3, assists: 2 },
];

// Minimal chainable Supabase stand-in covering only the calls this function makes.
function makeDb(config: {
  encounterCount: number;
  cachedRow: { encounter_count: number; entries: unknown } | null;
  instanceIds: string[];
}) {
  const upserts: Array<{ table: string; payload: Record<string, unknown> }> = [];
  return {
    upserts,
    from(table: string) {
      if (table === "bungie_accounts") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { membership_id: "viewer-1" }, error: null }) }) }) };
      }
      if (table === "crucible_encounters") {
        return {
          select: (_cols: string, opts?: { count?: string; head?: boolean }) => ({
            eq: async () => {
              if (opts?.head) return { count: config.encounterCount, error: null };
              return {
                data: config.instanceIds.map((instance_id) => ({ instance_id })),
                error: null,
              };
            },
          }),
        };
      }
      if (table === "match_hall_of_fame_cache") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: config.cachedRow, error: null }) }) }),
          upsert: (payload: Record<string, unknown>) => {
            upserts.push({ table, payload });
            return Promise.resolve({ error: null });
          },
        };
      }
      if (table === "crucible_matches" || table === "crucible_match_players") {
        return { select: () => ({ in: async () => ({ data: [], error: null }) }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("getMatchHallOfFame degraded path (Appwrite quota exhaustion)", () => {
  it("serves the stale cached entries and bumps encounter_count so repeat visits hit the cache instead of re-scanning", async () => {
    mockIsQuotaError.mockReturnValue(true);
    mockListTrialsStats.mockRejectedValue(new Error("database reads limit exceeded for the current billing cycle"));

    const db = makeDb({
      encounterCount: 42, // higher than the cached row -> forces the full recompute path
      cachedRow: { encounter_count: 40, entries: STALE_ENTRIES },
      instanceIds: ["match-a"],
    });
    const onDegraded = jest.fn();

    const result = await getMatchHallOfFame("user-1", { db: db as any, onDegraded });

    expect(result).toEqual(STALE_ENTRIES);
    expect(onDegraded).toHaveBeenCalledTimes(1);

    // The whole point of the fix: the cache row now reflects the CURRENT
    // encounter count, so the next request's `cached.encounter_count === encounterCount`
    // check hits the fast path instead of re-running this scan (and re-hitting
    // the exhausted Appwrite quota) again.
    expect(db.upserts).toHaveLength(1);
    expect(db.upserts[0].payload).toMatchObject({ user_id: "user-1", encounter_count: 42, entries: STALE_ENTRIES });
  });

  it("does not write a synthetic cache row when there is no prior cached result to fall back to", async () => {
    mockIsQuotaError.mockReturnValue(true);
    mockListTrialsStats.mockRejectedValue(new Error("rate limit exceeded"));

    const db = makeDb({
      encounterCount: 5,
      cachedRow: null,
      instanceIds: ["match-a"],
    });

    const result = await getMatchHallOfFame("user-1", { db: db as any });

    expect(result).toEqual([]);
    expect(db.upserts).toHaveLength(0);
  });

  it("rethrows non-quota errors instead of degrading", async () => {
    mockIsQuotaError.mockReturnValue(false);
    mockListTrialsStats.mockRejectedValue(new Error("boom"));

    const db = makeDb({
      encounterCount: 5,
      cachedRow: { encounter_count: 1, entries: STALE_ENTRIES },
      instanceIds: ["match-a"],
    });

    await expect(getMatchHallOfFame("user-1", { db: db as any })).rejects.toThrow("boom");
    expect(db.upserts).toHaveLength(0);
  });
});
