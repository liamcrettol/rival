/** @jest-environment node */
jest.mock("@/lib/auth/helpers", () => ({ requireSession: jest.fn() }));
jest.mock("@/lib/crucible/queueSync", () => ({ queueCrucibleSync: jest.fn() }));
jest.mock("@/lib/crucible/sync", () => ({ syncRecentCrucibleHistory: jest.fn() }));

import { POST } from "@/app/api/crucible/refresh/route";
import { requireSession } from "@/lib/auth/helpers";
import { queueCrucibleSync } from "@/lib/crucible/queueSync";
import { syncRecentCrucibleHistory } from "@/lib/crucible/sync";

const mockRequireSession = requireSession as jest.Mock;
const mockQueueCrucibleSync = queueCrucibleSync as jest.Mock;
const mockSyncRecentCrucibleHistory = syncRecentCrucibleHistory as jest.Mock;

describe("POST /api/crucible/refresh", () => {
  beforeEach(() => {
    mockRequireSession.mockReset();
    mockQueueCrucibleSync.mockReset();
    mockSyncRecentCrucibleHistory.mockReset();
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    (console.error as jest.Mock).mockRestore();
  });

  it("logs and still succeeds when backfill enrollment fails", async () => {
    mockRequireSession.mockResolvedValue({ userId: "user-1" });
    mockQueueCrucibleSync.mockRejectedValue(new Error("insert failed"));
    mockSyncRecentCrucibleHistory.mockResolvedValue({ imported: 3 });

    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, imported: 3 });
    expect(console.error).toHaveBeenCalledWith(
      "[crucible/refresh] backfill enrollment failed:",
      "insert failed",
    );
  });

  it("does not log when backfill enrollment succeeds", async () => {
    mockRequireSession.mockResolvedValue({ userId: "user-1" });
    mockQueueCrucibleSync.mockResolvedValue(undefined);
    mockSyncRecentCrucibleHistory.mockResolvedValue({ imported: 0 });

    const res = await POST();

    expect(res.status).toBe(200);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("maps a dead/cross-app Bungie refresh-token error to 401, not a logged 500", async () => {
    mockRequireSession.mockResolvedValue({ userId: "user-1" });
    mockQueueCrucibleSync.mockResolvedValue(undefined);
    mockSyncRecentCrucibleHistory.mockRejectedValue(
      new Error("Bungie sign-in expired. Please sign out and sign in again."),
    );

    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.ok).toBe(false);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("still maps an unrecognized failure to a logged 500", async () => {
    mockRequireSession.mockResolvedValue({ userId: "user-1" });
    mockQueueCrucibleSync.mockResolvedValue(undefined);
    mockSyncRecentCrucibleHistory.mockRejectedValue(new Error("boom"));

    const res = await POST();

    expect(res.status).toBe(500);
    expect(console.error).toHaveBeenCalledWith("[crucible/refresh] request failed:", "boom");
  });
});
