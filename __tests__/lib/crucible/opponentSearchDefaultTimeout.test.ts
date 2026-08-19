/** @jest-environment node */

const mockCreateAdminSupabaseClient = jest.fn();
jest.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: (...args: unknown[]) => mockCreateAdminSupabaseClient(...args),
}));

import { searchOpponents } from "@/lib/crucible/opponentSearch";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeStubDb(): any {
  const chain = {
    select: () => chain,
    eq: () => chain,
    ilike: () => chain,
    order: () => chain,
    limit: () => chain,
    then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
      return Promise.resolve({ data: [], error: null }).then(resolve, reject);
    },
  };
  return { from: jest.fn(() => chain) };
}

describe("searchOpponents default timeout", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    mockCreateAdminSupabaseClient.mockReset();
    // Keep the Bungie global-name search out of this test: reject so
    // searchOpponents' own .catch(() => []) short-circuits it.
    global.fetch = jest.fn().mockRejectedValue(new Error("network disabled in test"));
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("widens the default client timeout instead of riding the 1.2s app-wide budget, and reuses it for the head-to-head lookup", async () => {
    const stubDb = makeStubDb();
    mockCreateAdminSupabaseClient.mockReturnValue(stubDb);

    await searchOpponents({ viewerUserId: "viewer", query: "Guardian" });

    expect(mockCreateAdminSupabaseClient).toHaveBeenCalledWith(5_000);
    expect(stubDb.from).toHaveBeenCalledWith("crucible_encounters");
  });

  it("still honors an explicit db override instead of creating a new client", async () => {
    const explicitDb = makeStubDb();

    await searchOpponents({ viewerUserId: "viewer", query: "Guardian", db: explicitDb });

    expect(mockCreateAdminSupabaseClient).not.toHaveBeenCalled();
    expect(explicitDb.from).toHaveBeenCalledWith("crucible_encounters");
  });
});
