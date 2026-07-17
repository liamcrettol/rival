/** @jest-environment node */
jest.mock("@/lib/auth/helpers", () => ({ getBungieToken: jest.fn() }));

import { claimCrucibleSyncForUser } from "@/lib/crucible/sync";

// Chainable Supabase stand-in for the conditional claim update:
//   crucible_sync_state -> .update().eq().eq().select().maybeSingle()
function makeDb(config: { claimedRow: Record<string, unknown> | null }) {
  const calls: Array<{ patch: Record<string, unknown>; filters: Array<[string, unknown]> }> = [];
  return {
    calls,
    from(table: string) {
      expect(table).toBe("crucible_sync_state");
      const filters: Array<[string, unknown]> = [];
      const builder = {
        eq(column: string, value: unknown) {
          filters.push([column, value]);
          return builder;
        },
        select: () => builder,
        maybeSingle: async () => ({ data: config.claimedRow, error: null }),
      };
      return {
        update(patch: Record<string, unknown>) {
          calls.push({ patch, filters });
          return builder;
        },
      };
    },
  };
}

describe("claimCrucibleSyncForUser", () => {
  it("claims a queued row and marks it syncing", async () => {
    const claimedRow = { user_id: "user-1", status: "syncing" };
    const db = makeDb({ claimedRow });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await claimCrucibleSyncForUser("user-1", "worker-1", 90, db as any);

    expect(result).toEqual(claimedRow);
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0].patch).toMatchObject({ status: "syncing", locked_by: "worker-1" });
    expect(db.calls[0].filters).toEqual(
      expect.arrayContaining([["user_id", "user-1"], ["status", "queued"]]),
    );
  });

  it("returns null when the row is no longer queued (cron won the race)", async () => {
    const db = makeDb({ claimedRow: null });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await claimCrucibleSyncForUser("user-1", "worker-1", 90, db as any);

    expect(result).toBeNull();
  });

  it("throws on a database error", async () => {
    const db = {
      from: () => ({
        update: () => ({
          eq: () => ({
            eq: () => ({
              select: () => ({
                maybeSingle: async () => ({ data: null, error: { message: "boom" } }),
              }),
            }),
          }),
        }),
      }),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(claimCrucibleSyncForUser("user-1", "worker-1", 90, db as any)).rejects.toThrow(
      "claim_crucible_sync_for_user failed: boom",
    );
  });
});
