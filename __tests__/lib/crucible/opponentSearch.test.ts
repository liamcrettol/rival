/** @jest-environment node */
jest.mock("@/lib/supabase/admin", () => ({ adminSupabase: {}, createAdminSupabaseClient: jest.fn() }));
jest.mock("@/lib/crucible/headToHead", () => ({ getHeadToHeadSummaries: jest.fn(async () => ({})) }));

import {
  codeMatches,
  flattenBungieSearchResults,
  matchRank,
  parseNameQuery,
  searchOpponents,
} from "@/lib/crucible/opponentSearch";

const details = [{
  bungieGlobalDisplayName: "Guardian",
  bungieGlobalDisplayNameCode: 42,
  destinyMemberships: [
    {
      membershipId: "100",
      membershipType: 3,
      displayName: "old-steam-name",
      crossSaveOverride: 1,
      applicableMembershipTypes: [],
    },
    {
      membershipId: "200",
      membershipType: 1,
      displayName: "current-xbox-name",
      crossSaveOverride: 1,
      applicableMembershipTypes: [1, 3],
    },
  ],
}];

describe("flattenBungieSearchResults", () => {
  it("returns the active cross-save membership and formats the discriminator", () => {
    expect(flattenBungieSearchResults(details, "Guardian")).toEqual([
      expect.objectContaining({
        membershipId: "200",
        membershipType: 1,
        displayName: "Guardian#0042",
        platformDisplayName: "current-xbox-name",
        emblemPath: null,
      }),
    ]);
  });

  it("filters exact Name#code searches after searching the name prefix", () => {
    expect(flattenBungieSearchResults(details, "Guardian#0042")).toHaveLength(1);
    expect(flattenBungieSearchResults(details, "Guardian#0043")).toHaveLength(0);
  });

  it("rejects malformed membership ids", () => {
    const malformed = [{ ...details[0], destinyMemberships: [{ membershipId: "not-a-number" }] }];
    expect(flattenBungieSearchResults(malformed, "Guardian")).toEqual([]);
  });
});

describe("partial name queries", () => {
  it("splits the name from a full, partial or bare #code", () => {
    expect(parseNameQuery("Datto#1234")).toEqual({ prefix: "Datto", codePrefix: "1234" });
    expect(parseNameQuery("Datto # 12")).toEqual({ prefix: "Datto", codePrefix: "12" });
    expect(parseNameQuery("Datto#")).toEqual({ prefix: "Datto", codePrefix: "" });
    expect(parseNameQuery("  Datto  ")).toEqual({ prefix: "Datto", codePrefix: null });
    expect(parseNameQuery("#1234")).toEqual({ prefix: "#1234", codePrefix: null });
    expect(parseNameQuery("we#are#one")).toEqual({ prefix: "we#are#one", codePrefix: null });
  });

  it("treats a partial code as the start of the code", () => {
    expect(codeMatches(1234, "12")).toBe(true);
    expect(codeMatches(42, "00")).toBe(true);
    expect(codeMatches(42, "42")).toBe(true);
    expect(codeMatches(1234, "13")).toBe(false);
    expect(codeMatches(undefined, "1")).toBe(false);
    expect(codeMatches(undefined, "")).toBe(true);
  });

  it("keeps Bungie results whose code starts with a partial code", () => {
    const many = [
      { ...details[0], bungieGlobalDisplayNameCode: 1234, destinyMemberships: [{ membershipId: "1", applicableMembershipTypes: [3] }] },
      { ...details[0], bungieGlobalDisplayNameCode: 1290, destinyMemberships: [{ membershipId: "2", applicableMembershipTypes: [3] }] },
      { ...details[0], bungieGlobalDisplayNameCode: 5612, destinyMemberships: [{ membershipId: "3", applicableMembershipTypes: [3] }] },
    ];
    expect(flattenBungieSearchResults(many, "Guardian#12").map((r) => r.membershipId)).toEqual(["1", "2"]);
    expect(flattenBungieSearchResults(many, "Guardian#").map((r) => r.membershipId)).toEqual(["1", "2", "3"]);
  });

  it("ranks exact names, then name prefixes, then word prefixes, then anywhere", () => {
    const names = ["xXDattoXx#0001", "Datto Fan#0002", "Datto#0003", "Dattobayo#0004", "Big Datto#0005"];
    expect([...names].sort((a, b) => matchRank(a, "datto") - matchRank(b, "datto"))).toEqual([
      "Datto#0003", "Datto Fan#0002", "Dattobayo#0004", "Big Datto#0005", "xXDattoXx#0001",
    ]);
    expect(matchRank("Datto#0003", "Datto#0003")).toBeLessThan(matchRank("Datto#0003", "Datto"));
    expect(matchRank("Datto#5555", "Datto#12")).toBe(5);
  });
});

describe("searchOpponents", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    jest.clearAllMocks();
  });

  function localDb(rows: unknown[], error: unknown = null) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: Record<string, jest.Mock> = {} as any;
    Object.assign(chain, {
      select: jest.fn(() => chain),
      eq: jest.fn(() => chain),
      ilike: jest.fn(() => chain),
      order: jest.fn(() => chain),
      limit: jest.fn(() => Promise.resolve({ data: rows, error })),
    });
    return { from: jest.fn(() => chain), rpc: jest.fn(() => Promise.resolve({ data: [], error: null })), chain };
  }

  function bungieReply(byPath: Record<string, unknown>) {
    global.fetch = jest.fn(async (url: string) => {
      const path = Object.keys(byPath).find((key) => url.endsWith(key));
      const response = path ? byPath[path] : { searchResults: [] };
      if (response instanceof Error) return { ok: false, status: 503, json: async () => ({ ErrorCode: 5, Message: "down" }) };
      return { ok: true, status: 200, json: async () => ({ ErrorCode: 1, Response: response }) };
    }) as unknown as typeof fetch;
  }

  const person = (name: string, code: number, id: string) => ({
    bungieGlobalDisplayName: name,
    bungieGlobalDisplayNameCode: code,
    destinyMemberships: [{ membershipId: id, membershipType: 3, applicableMembershipTypes: [3] }],
  });

  it("ranks the closest name first and searches history by the name part only", async () => {
    const db = localDb([{ opponent_membership_id: "9", opponent_membership_type: 3, opponent_display_name: "Big Datto#0005", played_at: "2026-10-01" }]);
    bungieReply({ "/User/Search/GlobalName/0/": { searchResults: [person("Dattobayo", 4, "4"), person("Datto", 3, "3")] } });
    const { results, bungieUnavailable } = await searchOpponents({ viewerUserId: "u-rank", query: "Datto", db });
    expect(bungieUnavailable).toBe(false);
    expect(results.map((r) => r.displayName)).toEqual(["Datto#0003", "Dattobayo#0004", "Big Datto#0005"]);
    expect(db.chain.ilike).toHaveBeenCalledWith("opponent_display_name", "%Datto%");
  });

  it("uses Bungie's exact lookup for a full Name#code", async () => {
    bungieReply({
      "/User/Search/GlobalName/0/": { searchResults: [] },
      "/Destiny2/SearchDestinyPlayerByBungieName/-1/": [
        { membershipId: "77", membershipType: 2, bungieGlobalDisplayName: "Commonname", bungieGlobalDisplayNameCode: 4521, applicableMembershipTypes: [2] },
      ],
    });
    const { results } = await searchOpponents({ viewerUserId: "u-exact", query: "Commonname#4521", db: localDb([]) });
    expect(results.map((r) => [r.membershipId, r.displayName])).toEqual([["77", "Commonname#4521"]]);
  });

  it("reads extra Bungie pages for a partial code", async () => {
    bungieReply({
      "/User/Search/GlobalName/0/": { searchResults: [person("Pagey", 9999, "1")] },
      "/User/Search/GlobalName/2/": { searchResults: [person("Pagey", 1234, "2")] },
    });
    const { results } = await searchOpponents({ viewerUserId: "u-pages", query: "Pagey#12", db: localDb([]) });
    expect(results.map((r) => r.membershipId)).toEqual(["2"]);
  });

  it("still suggests players you have met when Bungie is down", async () => {
    bungieReply({ "/User/Search/GlobalName/0/": new Error("down") });
    const db = localDb([{ opponent_membership_id: "5", opponent_membership_type: 3, opponent_display_name: "Downtime#0001", played_at: "2026-10-01" }]);
    const { results, bungieUnavailable } = await searchOpponents({ viewerUserId: "u-down", query: "Downt", db });
    expect(bungieUnavailable).toBe(true);
    expect(results.map((r) => r.membershipId)).toEqual(["5"]);
  });

  it("still suggests Bungie players when the history search fails", async () => {
    bungieReply({ "/User/Search/GlobalName/0/": { searchResults: [person("Historyless", 1, "6")] } });
    const { results } = await searchOpponents({ viewerUserId: "u-local", query: "Historyl", db: localDb([], { message: "timeout" }) });
    expect(results.map((r) => r.membershipId)).toEqual(["6"]);
  });
});
