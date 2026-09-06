/** @jest-environment node */
import { NextRequest } from "next/server";

const mockIn = jest.fn();
jest.mock("@/lib/supabase/admin", () => ({
  withSupabaseTimeout: (p: unknown) => p,
  adminSupabase: {
    from: () => ({
      select: () => ({
        in: (...args: unknown[]) => mockIn(...args),
      }),
    }),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let POST: (req: NextRequest) => Promise<any>;

beforeAll(() => {
  process.env.REROLLED_SYNC_SECRET = "shared-secret";
  POST = require("@/app/api/internal/rerolled/account-exists/route").POST;
});

beforeEach(() => {
  jest.clearAllMocks();
});

function req(body: unknown, auth = "Bearer shared-secret") {
  return new NextRequest("https://test.app/api/internal/rerolled/account-exists", {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

it("rejects an unauthorized caller", async () => {
  const res = await POST(req({ userIds: ["a"] }, "Bearer wrong"));
  expect(res.status).toBe(401);
  expect(mockIn).not.toHaveBeenCalled();
});

it("rejects a missing/empty userIds array", async () => {
  const res = await POST(req({ userIds: [] }));
  expect(res.status).toBe(400);
});

it("rejects a batch over the size limit", async () => {
  const res = await POST(req({ userIds: Array.from({ length: 501 }, (_, i) => `u${i}`) }));
  expect(res.status).toBe(400);
});

it("returns which of the requested user ids have a real Rival account", async () => {
  mockIn.mockResolvedValue({ data: [{ user_id: "user-1" }, { user_id: "user-3" }], error: null });

  const res = await POST(req({ userIds: ["user-1", "user-2", "user-3"] }));
  const body = await res.json();

  expect(res.status).toBe(200);
  expect(body.existingUserIds.sort()).toEqual(["user-1", "user-3"]);
  expect(mockIn).toHaveBeenCalledWith("user_id", ["user-1", "user-2", "user-3"]);
});

it("does not count a user whose users row exists but bungie_accounts never completed", async () => {
  // Guards against reintroducing the users-table check this route used to
  // have: a users row with no bungie_accounts row is a half-created
  // account (process killed between the two upserts) and must still read
  // as "no account" so Rerolled's reconcile cron releases the slot.
  mockIn.mockResolvedValue({ data: [], error: null });

  const res = await POST(req({ userIds: ["half-created"] }));
  const body = await res.json();

  expect(body.existingUserIds).toEqual([]);
});

it("returns 503 instead of masking a query failure as no accounts existing", async () => {
  const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  mockIn.mockResolvedValue({ data: null, error: { message: "connection reset" } });

  const res = await POST(req({ userIds: ["user-1"] }));

  expect(res.status).toBe(503);
  errSpy.mockRestore();
});
