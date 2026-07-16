/** @jest-environment node */
// sync.ts statically imports the auth helpers, which load Supabase at import
// time. Stub the module out (unused by materializeKnownCrucibleMatches).
jest.mock("@/lib/auth/helpers", () => ({ getBungieToken: jest.fn() }));

import { materializeKnownCrucibleMatches } from "@/lib/crucible/sync";

// Minimal chainable Supabase stand-in. materializeKnownCrucibleMatches only:
//   reads  crucible_sync_state.known_matches_materialized_at -> .eq().maybeSingle()
//   calls  db.rpc("materialize_sitewide_crucible_viewers", ...)
//   writes crucible_sync_state.known_matches_materialized_at -> .update().eq()
function makeDb(config: {
  knownMatchesMaterializedAt?: string | null;
  rpcResult?: { data?: unknown; error?: { message: string } | null };
}) {
  const rpcCalls: Array<{ name: string; args: unknown }> = [];
  const updates: Array<Record<string, unknown>> = [];
  return {
    rpcCalls,
    updates,
    from(table: string) {
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () => ({
          data: table === "crucible_sync_state"
            ? { known_matches_materialized_at: config.knownMatchesMaterializedAt ?? null }
            : null,
        }),
        update: (patch: Record<string, unknown>) => {
          updates.push(patch);
          return { eq: async () => ({ error: null }) };
        },
      };
      return builder;
    },
    rpc: async (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      return config.rpcResult ?? { data: { viewers_inserted: 0, encounters_inserted: 0 }, error: null };
    },
  };
}

describe("materializeKnownCrucibleMatches", () => {
  it("calls the sitewide RPC and stamps the freshness timestamp when never run before", async () => {
    const db = makeDb({ knownMatchesMaterializedAt: null });
    await materializeKnownCrucibleMatches("user-1", db as never);

    expect(db.rpcCalls).toEqual([
      { name: "materialize_sitewide_crucible_viewers", args: { p_user_ids: ["user-1"] } },
    ]);
    expect(db.updates).toHaveLength(1);
    expect(typeof db.updates[0].known_matches_materialized_at).toBe("string");
  });

  it("skips the RPC entirely when the freshness window has not elapsed", async () => {
    const db = makeDb({ knownMatchesMaterializedAt: new Date().toISOString() });
    await materializeKnownCrucibleMatches("user-1", db as never);

    expect(db.rpcCalls).toEqual([]);
    expect(db.updates).toEqual([]);
  });

  it("re-runs once the freshness window has elapsed", async () => {
    const staleTimestamp = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const db = makeDb({ knownMatchesMaterializedAt: staleTimestamp });
    await materializeKnownCrucibleMatches("user-1", db as never);

    expect(db.rpcCalls).toHaveLength(1);
    expect(db.updates).toHaveLength(1);
  });

  it("swallows RPC errors and leaves the freshness timestamp untouched", async () => {
    const db = makeDb({
      knownMatchesMaterializedAt: null,
      rpcResult: { data: null, error: { message: "boom" } },
    });
    await expect(materializeKnownCrucibleMatches("user-1", db as never)).resolves.toBeUndefined();

    expect(db.rpcCalls).toHaveLength(1);
    expect(db.updates).toEqual([]);
  });

  it("never throws even when the db client itself throws", async () => {
    const db = {
      from() {
        throw new Error("db unavailable");
      },
      rpc: async () => ({ data: null, error: null }),
    };
    await expect(materializeKnownCrucibleMatches("user-1", db as never)).resolves.toBeUndefined();
  });
});
