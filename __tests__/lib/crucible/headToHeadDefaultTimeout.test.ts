/** @jest-environment node */

const mockCreateAdminSupabaseClient = jest.fn();
jest.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: (...args: unknown[]) => mockCreateAdminSupabaseClient(...args),
}));

import { getHeadToHeadSummaries, getHeadToHeadMatches } from "@/lib/crucible/headToHead";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeStubDb(): any {
  const chain = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    order: () => chain,
    limit: () => chain,
    then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
      return Promise.resolve({ data: [], error: null }).then(resolve, reject);
    },
  };
  return { from: jest.fn(() => chain) };
}

describe("getHeadToHeadSummaries / getHeadToHeadMatches default timeout", () => {
  beforeEach(() => {
    mockCreateAdminSupabaseClient.mockReset();
  });

  it("getHeadToHeadSummaries widens the default client timeout instead of riding the 1.2s app-wide budget", async () => {
    const stubDb = makeStubDb();
    mockCreateAdminSupabaseClient.mockReturnValue(stubDb);

    await getHeadToHeadSummaries({ viewerUserId: "viewer", opponentMembershipIds: ["opp-1"] });

    expect(mockCreateAdminSupabaseClient).toHaveBeenCalledWith(5_000);
    expect(stubDb.from).toHaveBeenCalledWith("crucible_encounters");
  });

  it("getHeadToHeadMatches widens the default client timeout instead of riding the 1.2s app-wide budget", async () => {
    const stubDb = makeStubDb();
    mockCreateAdminSupabaseClient.mockReturnValue(stubDb);

    await getHeadToHeadMatches({ viewerUserId: "viewer", opponentMembershipId: "opp-1" });

    expect(mockCreateAdminSupabaseClient).toHaveBeenCalledWith(5_000);
    expect(stubDb.from).toHaveBeenCalledWith("crucible_encounters");
  });

  it("still honors an explicit db override instead of creating a new client", async () => {
    const explicitDb = makeStubDb();

    await getHeadToHeadSummaries({ viewerUserId: "viewer", opponentMembershipIds: ["opp-1"], db: explicitDb });

    expect(mockCreateAdminSupabaseClient).not.toHaveBeenCalled();
    expect(explicitDb.from).toHaveBeenCalledWith("crucible_encounters");
  });
});
