/** @jest-environment node */

const mockCreateAdminSupabaseClient = jest.fn();
jest.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: (...args: unknown[]) => mockCreateAdminSupabaseClient(...args),
}));

import { getHeadToHeadMatches } from "@/lib/crucible/headToHead";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeStubDb(orSpy: jest.Mock): any {
  const chain = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    order: () => chain,
    limit: () => chain,
    or: (filter: string) => {
      orSpy(filter);
      return chain;
    },
    then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
      return Promise.resolve({ data: [], error: null }).then(resolve, reject);
    },
  };
  return { from: jest.fn(() => chain) };
}

function encodeCursor(raw: string): string {
  return Buffer.from(raw, "utf8").toString("base64url");
}

describe("getHeadToHeadMatches cursor validation", () => {
  beforeEach(() => {
    mockCreateAdminSupabaseClient.mockReset();
  });

  it("passes a well-formed cursor straight through to the .or() filter", async () => {
    const orSpy = jest.fn();
    const db = makeStubDb(orSpy);

    await getHeadToHeadMatches({
      viewerUserId: "viewer",
      opponentMembershipId: "opp-1",
      cursor: encodeCursor("2026-07-09T20:00:00Z|4611686018467"),
      db,
    });

    expect(orSpy).toHaveBeenCalledWith(
      "played_at.lt.2026-07-09T20:00:00Z,and(played_at.eq.2026-07-09T20:00:00Z,instance_id.lt.4611686018467)"
    );
  });

  it("rejects a cursor whose instance_id half injects extra PostgREST filter syntax", async () => {
    const orSpy = jest.fn();
    const db = makeStubDb(orSpy);

    await expect(
      getHeadToHeadMatches({
        viewerUserId: "viewer",
        opponentMembershipId: "opp-1",
        cursor: encodeCursor("2026-07-09T20:00:00Z|1,or(viewer_won.is.null"),
        db,
      })
    ).rejects.toThrow("Invalid head-to-head cursor");

    expect(orSpy).not.toHaveBeenCalled();
  });

  it("rejects a cursor whose played_at half is not a real timestamp", async () => {
    const orSpy = jest.fn();
    const db = makeStubDb(orSpy);

    await expect(
      getHeadToHeadMatches({
        viewerUserId: "viewer",
        opponentMembershipId: "opp-1",
        cursor: encodeCursor("not-a-timestamp,or(1.eq.1|1"),
        db,
      })
    ).rejects.toThrow("Invalid head-to-head cursor");

    expect(orSpy).not.toHaveBeenCalled();
  });
});
