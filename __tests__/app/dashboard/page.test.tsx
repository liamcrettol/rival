jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));
jest.mock("next/navigation", () => ({ redirect: jest.fn() }));
jest.mock("@/lib/crucible/queueSync", () => ({ queueCrucibleSync: jest.fn() }));
jest.mock("@/lib/crucible/sync", () => ({
  claimCrucibleSyncForUser: jest.fn(),
  materializeKnownCrucibleMatches: jest.fn(),
  syncNextCrucibleHistoryPage: jest.fn(),
}));
jest.mock("@/lib/crucible/matchHistory", () => ({ getCrucibleMatchHistory: jest.fn() }));

jest.mock("@/components/MatchHistoryPanel", () => ({ __esModule: true, default: () => null }));
jest.mock("@/components/CrucibleHistorySync", () => ({ __esModule: true, default: () => null }));
jest.mock("@/components/BrandMark", () => ({ __esModule: true, default: () => null }));
jest.mock("@/components/SignOutButton", () => ({ __esModule: true, default: () => null }));
jest.mock("@/components/crucible/OpponentSearch", () => ({ __esModule: true, default: () => null }));

import Dashboard from "@/app/dashboard/page";
import { auth } from "@/lib/auth";
import { queueCrucibleSync } from "@/lib/crucible/queueSync";
import {
  claimCrucibleSyncForUser,
  materializeKnownCrucibleMatches,
  syncNextCrucibleHistoryPage,
} from "@/lib/crucible/sync";
import { getCrucibleMatchHistory } from "@/lib/crucible/matchHistory";

const mockAuth = auth as jest.Mock;
const mockQueueCrucibleSync = queueCrucibleSync as jest.Mock;
const mockClaimCrucibleSyncForUser = claimCrucibleSyncForUser as jest.Mock;
const mockMaterializeKnownCrucibleMatches = materializeKnownCrucibleMatches as jest.Mock;
const mockSyncNextCrucibleHistoryPage = syncNextCrucibleHistoryPage as jest.Mock;
const mockGetCrucibleMatchHistory = getCrucibleMatchHistory as jest.Mock;

const session = { userId: "user-1", displayName: "Guardian" };

describe("Dashboard first-sign-in backfill", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.mockResolvedValue(session);
    mockMaterializeKnownCrucibleMatches.mockResolvedValue(undefined);
    mockGetCrucibleMatchHistory.mockResolvedValue({ matches: [], syncStatus: "queued" });
  });

  it("runs one synchronous backfill page for a brand-new, never-synced account", async () => {
    mockQueueCrucibleSync.mockResolvedValue({
      status: "queued",
      backfill_completed_at: null,
      last_incremental_sync_at: null,
    });
    mockClaimCrucibleSyncForUser.mockResolvedValue({ status: "syncing" });
    mockSyncNextCrucibleHistoryPage.mockResolvedValue({ processedActivities: 5, importedMatches: 5, hasMore: true });

    await Dashboard();

    expect(mockClaimCrucibleSyncForUser).toHaveBeenCalledWith("user-1", "dashboard-user-1");
    expect(mockSyncNextCrucibleHistoryPage).toHaveBeenCalledWith("user-1");
  });

  it("skips the synchronous backfill when the claim loses the race to the cron", async () => {
    mockQueueCrucibleSync.mockResolvedValue({
      status: "queued",
      backfill_completed_at: null,
      last_incremental_sync_at: null,
    });
    mockClaimCrucibleSyncForUser.mockResolvedValue(null);

    await Dashboard();

    expect(mockClaimCrucibleSyncForUser).toHaveBeenCalled();
    expect(mockSyncNextCrucibleHistoryPage).not.toHaveBeenCalled();
  });

  it("does not run the synchronous backfill for a returning user with a completed backfill", async () => {
    mockQueueCrucibleSync.mockResolvedValue({
      status: "queued",
      backfill_completed_at: "2026-07-01T00:00:00.000Z",
      last_incremental_sync_at: "2026-07-16T00:00:00.000Z",
    });

    await Dashboard();

    expect(mockClaimCrucibleSyncForUser).not.toHaveBeenCalled();
    expect(mockSyncNextCrucibleHistoryPage).not.toHaveBeenCalled();
  });

  it("does not run the synchronous backfill for a user already mid-sync", async () => {
    mockQueueCrucibleSync.mockResolvedValue({
      status: "syncing",
      backfill_completed_at: null,
      last_incremental_sync_at: null,
    });

    await Dashboard();

    expect(mockClaimCrucibleSyncForUser).not.toHaveBeenCalled();
    expect(mockSyncNextCrucibleHistoryPage).not.toHaveBeenCalled();
  });
});
