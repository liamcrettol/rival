/** @jest-environment node */
jest.mock("@/lib/auth/cron", () => ({ assertCronAuth: jest.fn(() => null) }));
jest.mock("@/lib/supabase/admin", () => ({ createAdminSupabaseClient: jest.fn() }));
jest.mock("@/lib/crucible/trialsStatsStore", () => ({
  isTrialsStatsQuotaError: jest.fn(),
  listTrialsStats: jest.fn(),
  needsTrialsStatsFetch: jest.fn(),
}));
jest.mock("@/lib/crucible/trialsBackfill", () => ({ refreshOpponents: jest.fn() }));

import { GET } from "@/app/api/cron/sync-trials-kd/route";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { isTrialsStatsQuotaError, listTrialsStats, needsTrialsStatsFetch } from "@/lib/crucible/trialsStatsStore";
import { refreshOpponents } from "@/lib/crucible/trialsBackfill";

const mockCreateAdminSupabaseClient = createAdminSupabaseClient as jest.Mock;
const mockListTrialsStats = listTrialsStats as jest.Mock;
const mockIsTrialsStatsQuotaError = isTrialsStatsQuotaError as jest.Mock;
const mockNeedsTrialsStatsFetch = needsTrialsStatsFetch as jest.Mock;
const mockRefreshOpponents = refreshOpponents as jest.Mock;

function dbWithAccountsAndCandidates(candidates: Array<{ membership_id: string; membership_type: number | null }>) {
  return {
    from: () => ({
      select: async () => ({ data: [{ user_id: "user-1" }], error: null }),
    }),
    rpc: async () => ({ data: candidates, error: null }),
  };
}

const req = {} as never;

describe("GET /api/cron/sync-trials-kd", () => {
  beforeEach(() => {
    mockCreateAdminSupabaseClient.mockReset();
    mockListTrialsStats.mockReset();
    mockIsTrialsStatsQuotaError.mockReset();
    mockNeedsTrialsStatsFetch.mockReset();
    mockRefreshOpponents.mockReset();
  });

  it("degrades gracefully instead of 500ing when the Appwrite read quota is exhausted", async () => {
    mockCreateAdminSupabaseClient.mockReturnValue(
      dbWithAccountsAndCandidates([{ membership_id: "m1", membership_type: 3 }])
    );
    mockListTrialsStats.mockRejectedValue(new Error("Database reads limit for current billing cycle has been exceeded"));
    mockIsTrialsStatsQuotaError.mockReturnValue(true);

    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, skipped: "quota_exhausted", candidates: 1 });
    expect(mockRefreshOpponents).not.toHaveBeenCalled();
  });

  it("still 500s on a non-quota listTrialsStats failure", async () => {
    mockCreateAdminSupabaseClient.mockReturnValue(
      dbWithAccountsAndCandidates([{ membership_id: "m1", membership_type: 3 }])
    );
    mockListTrialsStats.mockRejectedValue(new Error("network timeout"));
    mockIsTrialsStatsQuotaError.mockReturnValue(false);

    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.ok).toBe(false);
  });

  it("proceeds to refresh due opponents on the happy path", async () => {
    mockCreateAdminSupabaseClient.mockReturnValue(
      dbWithAccountsAndCandidates([{ membership_id: "m1", membership_type: 3 }])
    );
    mockListTrialsStats.mockResolvedValue(new Map());
    mockNeedsTrialsStatsFetch.mockReturnValue(true);
    mockRefreshOpponents.mockResolvedValue({ updated: 1, failed: 0, remaining: 0 });

    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, candidates: 1, due: 1, updated: 1, failed: 0, remaining: 0 });
  });
});
