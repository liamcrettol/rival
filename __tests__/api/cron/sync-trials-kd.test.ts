/** @jest-environment node */
import { NextRequest } from "next/server";

const mockDb = {
  from: jest.fn(),
  rpc: jest.fn(),
};
jest.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => mockDb,
}));

const mockListTrialsStats = jest.fn();
jest.mock("@/lib/crucible/trialsStatsStore", () => {
  const actual = jest.requireActual("@/lib/crucible/trialsStatsStore");
  return {
    ...actual,
    listTrialsStats: (...args: unknown[]) => mockListTrialsStats(...args),
  };
});

const mockRefreshOpponents = jest.fn();
jest.mock("@/lib/crucible/trialsBackfill", () => ({
  refreshOpponents: (...args: unknown[]) => mockRefreshOpponents(...args),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let GET: (req: NextRequest) => Promise<any>;

beforeAll(() => {
  process.env.CRON_SECRET = "test-cron-secret";
  GET = require("@/app/api/cron/sync-trials-kd/route").GET;
});

function req() {
  return new NextRequest("https://test.app/api/cron/sync-trials-kd", {
    headers: { Authorization: "Bearer test-cron-secret" },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.from.mockReturnValue({
    select: jest.fn().mockReturnValue({
      limit: jest.fn().mockResolvedValue({
        data: [{ user_id: "user-1" }],
        error: null,
      }),
    }),
  });
  mockDb.rpc.mockResolvedValue({
    data: [{ membership_id: "opp-1", membership_type: 3 }],
    error: null,
  });
});

it("skips this run without a 500 when Appwrite read quota is exhausted", async () => {
  const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  mockListTrialsStats.mockRejectedValue(new Error("database reads limit exceeded for current billing cycle"));

  const res = await GET(req());
  const body = await res.json();

  expect(res.status).toBe(200);
  expect(body).toMatchObject({ ok: true, skipped: "appwrite_quota_exhausted" });
  expect(mockRefreshOpponents).not.toHaveBeenCalled();
  errSpy.mockRestore();
});

it("still 500s on a non-quota Appwrite/lookup failure", async () => {
  mockListTrialsStats.mockRejectedValue(new Error("network timeout"));

  const res = await GET(req());
  const body = await res.json();

  expect(res.status).toBe(500);
  expect(body.ok).toBe(false);
});

it("caps the account scan with .limit()", async () => {
  const limit = jest.fn().mockResolvedValue({ data: [{ user_id: "user-1" }], error: null });
  mockDb.from.mockReturnValue({ select: jest.fn().mockReturnValue({ limit }) });
  mockListTrialsStats.mockResolvedValue(new Map());
  mockRefreshOpponents.mockResolvedValue({ refreshed: 0 });

  await GET(req());

  expect(limit).toHaveBeenCalledWith(2000);
});

it("skips one account's failed RPC instead of aborting the whole batch", async () => {
  mockDb.from.mockReturnValue({
    select: jest.fn().mockReturnValue({
      limit: jest.fn().mockResolvedValue({
        data: [{ user_id: "user-bad" }, { user_id: "user-good" }],
        error: null,
      }),
    }),
  });
  mockDb.rpc.mockImplementation((_fn: string, args: { p_viewer_user_id: string }) => {
    if (args.p_viewer_user_id === "user-bad") {
      return Promise.resolve({ data: null, error: { message: "rpc exploded" } });
    }
    return Promise.resolve({ data: [{ membership_id: "opp-1", membership_type: 3 }], error: null });
  });
  const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  mockListTrialsStats.mockResolvedValue(new Map());
  mockRefreshOpponents.mockResolvedValue({ refreshed: 1 });

  const res = await GET(req());
  const body = await res.json();

  expect(res.status).toBe(200);
  expect(body.ok).toBe(true);
  expect(body.candidates).toBe(1);
  errSpy.mockRestore();
});
