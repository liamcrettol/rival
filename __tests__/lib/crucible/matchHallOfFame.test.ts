/** @jest-environment node */
// #8 — on an Appwrite Trials-stats quota outage, getMatchHallOfFame degrades to
// serving the last cached result, but never bumped the cache row's
// encounter_count. That left the cache-hit fast path (line ~66) missing on
// every subsequent visit for the rest of the outage, re-running the full
// unbounded Supabase scan and re-hitting the exhausted Appwrite quota on
// every request instead of actually caching anything.
jest.mock("@/lib/crucible/trialsStatsStore", () => ({
  isTrialsStatsQuotaError: (error: unknown) => (error as { quota?: boolean } | null)?.quota === true,
  listTrialsStats: jest.fn(),
}));

import { getMatchHallOfFame } from "@/lib/crucible/matchHallOfFame";
import { listTrialsStats } from "@/lib/crucible/trialsStatsStore";

const mockListTrialsStats = listTrialsStats as jest.Mock;

type Row = Record<string, unknown>;

function makeDb(config: {
  account?: Row | null;
  encounterCount?: number;
  encounterRows?: Row[];
  cached?: Row | null;
  matches?: Row[];
  players?: Row[];
  onUpdate?: (patch: Row) => void;
  onUpsert?: (row: Row) => void;
  encounterQueryLimit?: number;
  onMatchesIn?: (ids: string[]) => void;
  onPlayersIn?: (ids: string[]) => void;
}) {
  return {
    from(table: string) {
      if (table === "bungie_accounts") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: config.account ?? { membership_id: "viewer-mem" }, error: null }),
            }),
          }),
        };
      }
      if (table === "crucible_encounters") {
        return {
          select: (_cols: string, opts?: { count?: string; head?: boolean }) => ({
            eq: () => {
              const resolveResult = async () => {
                if (opts?.count === "exact" && opts?.head) {
                  return { count: config.encounterCount ?? 0, error: null };
                }
                return { data: config.encounterRows ?? [], error: null };
              };
              // Thenable so the (unlimited) count query can still be awaited
              // directly, and chainable so the row scan can call .limit().
              return {
                limit: (n: number) => {
                  config.encounterQueryLimit = n;
                  return resolveResult();
                },
                then: (resolve: (value: unknown) => void, reject: (reason?: unknown) => void) =>
                  resolveResult().then(resolve, reject),
              };
            },
          }),
        };
      }
      if (table === "match_hall_of_fame_cache") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: config.cached ?? null, error: null }),
            }),
          }),
          update: (patch: Row) => ({
            eq: async () => {
              config.onUpdate?.(patch);
              return { error: null };
            },
          }),
          upsert: async (row: Row) => {
            config.onUpsert?.(row);
            return { error: null };
          },
        };
      }
      if (table === "crucible_matches") {
        return {
          select: () => ({
            in: async (_col: string, ids: string[]) => {
              config.onMatchesIn?.(ids);
              return { data: (config.matches ?? []).filter((m) => ids.includes(m.instance_id as string)), error: null };
            },
          }),
        };
      }
      if (table === "crucible_match_players") {
        return {
          select: () => ({
            in: async (_col: string, ids: string[]) => {
              config.onPlayersIn?.(ids);
              return { data: (config.players ?? []).filter((p) => ids.includes(p.instance_id as string)), error: null };
            },
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

const QUOTA_ERROR = { quota: true, message: "database reads limit" };

describe("getMatchHallOfFame — Appwrite quota degradation (#8)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("bumps the stale cache's encounter_count so the next visit hits the fast path", async () => {
    mockListTrialsStats.mockRejectedValue(QUOTA_ERROR);
    const onUpdate = jest.fn();
    const onDegraded = jest.fn();
    const cachedEntries = [{ instanceId: "old-match", rank: 1 }];
    const db = makeDb({
      encounterCount: 5,
      encounterRows: [{ instance_id: "m1" }],
      cached: { encounter_count: 3, entries: cachedEntries },
      onUpdate,
    });

    const result = await getMatchHallOfFame("user-1", { db, onDegraded });

    expect(onDegraded).toHaveBeenCalled();
    expect(result).toBe(cachedEntries);
    expect(onUpdate).toHaveBeenCalledWith({ encounter_count: 5 });
  });

  it("returns empty and skips the cache bump when there is no prior cached result", async () => {
    mockListTrialsStats.mockRejectedValue(QUOTA_ERROR);
    const onUpdate = jest.fn();
    const db = makeDb({
      encounterCount: 5,
      encounterRows: [{ instance_id: "m1" }],
      cached: null,
      onUpdate,
    });

    const result = await getMatchHallOfFame("user-1", { db });

    expect(result).toEqual([]);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("re-throws a non-quota error instead of degrading", async () => {
    mockListTrialsStats.mockRejectedValue(new Error("boom"));
    const db = makeDb({
      encounterCount: 5,
      encounterRows: [{ instance_id: "m1" }],
      cached: { encounter_count: 3, entries: [] },
    });

    await expect(getMatchHallOfFame("user-1", { db })).rejects.toThrow("boom");
  });
});

describe("getMatchHallOfFame — batched match/player lookups (#34)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListTrialsStats.mockResolvedValue([]);
  });

  it("chunks a large instance-id list into batches instead of one unbounded IN() query", async () => {
    const instanceIds = Array.from({ length: 150 }, (_, i) => `m${i}`);
    const matchesInCalls: string[][] = [];
    const playersInCalls: string[][] = [];
    const db = makeDb({
      encounterCount: instanceIds.length,
      encounterRows: instanceIds.map((instance_id) => ({ instance_id })),
      cached: null,
      onMatchesIn: (ids) => matchesInCalls.push(ids),
      onPlayersIn: (ids) => playersInCalls.push(ids),
    });

    await getMatchHallOfFame("user-1", { db });

    // Same 100-id batch size as getHeadToHeadSummaries' loadMatchMetadata.
    expect(matchesInCalls.length).toBe(2);
    expect(matchesInCalls[0].length).toBe(100);
    expect(matchesInCalls[1].length).toBe(50);
    expect(playersInCalls.length).toBe(2);
    // Every instance id is covered exactly once, across both batches.
    expect(new Set(matchesInCalls.flat()).size).toBe(150);
  });
});

describe("getMatchHallOfFame — bounded encounter scan (#9)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("caps the encounter history scan instead of reading an unbounded row set", async () => {
    const config: Parameters<typeof makeDb>[0] = {
      encounterCount: 5,
      encounterRows: [],
      cached: null,
    };
    const db = makeDb(config);

    await getMatchHallOfFame("user-1", { db });

    expect(config.encounterQueryLimit).toBe(50_000);
  });
});
