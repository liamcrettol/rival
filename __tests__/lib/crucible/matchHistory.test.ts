/** @jest-environment node */
// getCrucibleMatchHistory's needsReauth flag (dashboard-page fix, 2026-09-13
// scheduled audit): a "failed" sync parked for a dead/cross-app Bungie
// refresh token (lib/crucible/sync.ts's failCrucibleSync) previously looked
// identical to any other failure or to "no matches yet" - the viewer had no
// way to know signing in again would fix it. Uses instanceIds: [] to hit the
// early return right after the sync-state read, without needing to mock the
// full match/roster pipeline.
import { getCrucibleMatchHistory } from "@/lib/crucible/matchHistory";

type Row = Record<string, unknown>;

function makeDb(config: { account?: Row | null; syncState?: Row | null }) {
  return {
    from(table: string) {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              if (table === "bungie_accounts") {
                return { data: config.account ?? { membership_id: "m1" }, error: null };
              }
              if (table === "crucible_sync_state") {
                return { data: config.syncState ?? null, error: null };
              }
              throw new Error(`unexpected table ${table}`);
            },
          }),
        }),
      };
    },
  };
}

describe("getCrucibleMatchHistory needsReauth", () => {
  it("is true when the sync is parked failed with a Bungie reauth error", async () => {
    const db = makeDb({
      syncState: { status: "failed", last_error: "Bungie sign-in expired. Please sign out and sign in again." },
    });

    const result = await getCrucibleMatchHistory("user-1", { instanceIds: [], db });
    expect(result).toEqual({ matches: [], syncStatus: "failed", needsReauth: true });
  });

  it("is false when failed for a non-auth reason (e.g. DestinyPrivacyRestriction)", async () => {
    const db = makeDb({
      syncState: { status: "failed", last_error: "DestinyPrivacyRestriction" },
    });

    const result = await getCrucibleMatchHistory("user-1", { instanceIds: [], db });
    expect(result).toEqual({ matches: [], syncStatus: "failed", needsReauth: false });
  });

  it("is false for a healthy queued/syncing/complete state", async () => {
    const db = makeDb({ syncState: { status: "syncing", last_error: null } });

    const result = await getCrucibleMatchHistory("user-1", { instanceIds: [], db });
    expect(result).toEqual({ matches: [], syncStatus: "syncing", needsReauth: false });
  });

  it("is false when there is no sync-state row yet (idle)", async () => {
    const db = makeDb({ syncState: null });

    const result = await getCrucibleMatchHistory("user-1", { instanceIds: [], db });
    expect(result).toEqual({ matches: [], syncStatus: "idle", needsReauth: false });
  });

  it("is false when there is no linked Bungie account at all", async () => {
    const db = makeDb({ account: null });

    const result = await getCrucibleMatchHistory("user-1", { instanceIds: [], db });
    expect(result).toEqual({ matches: [], syncStatus: "idle", needsReauth: false });
  });
});
