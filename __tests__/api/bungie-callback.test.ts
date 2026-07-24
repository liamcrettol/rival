/** @jest-environment node */
// The shared signup-cap sync to Rerolled must never lock out a user who
// already has a local Rival account - only a genuinely new signup should
// depend on that cross-site call succeeding.
import { NextRequest } from "next/server";

const mockFrom = jest.fn();
jest.mock("@/lib/supabase/admin", () => ({
  adminSupabase: { from: (...args: unknown[]) => mockFrom(...args) },
}));
jest.mock("@auth/core/jwt", () => ({ encode: jest.fn() }));
jest.mock("@/lib/auth/encrypt", () => ({
  encryptToken: jest.fn().mockRejectedValue(new Error("stop after capacity check")),
}));
jest.mock("@/lib/crucible/queueSync", () => ({ queueCrucibleSync: jest.fn() }));
jest.mock("@/lib/crucible/sync", () => ({ materializeKnownCrucibleMatches: jest.fn() }));

const mockReserveSignupSlot = jest.fn();
jest.mock("@/lib/auth/signupCapacity", () => ({
  reserveSignupSlot: (...args: unknown[]) => mockReserveSignupSlot(...args),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let GET: (req: NextRequest) => Promise<any>;

beforeAll(() => {
  process.env.NEXTAUTH_URL = "https://rival.test";
  process.env.BUNGIE_API_KEY = "test-key";
  process.env.BUNGIE_CLIENT_ID = "cid";
  process.env.BUNGIE_CLIENT_SECRET = "csecret";
  GET = require("@/app/api/auth/bungie/callback/route").GET;
});

function usersTableReturning(existingUser: { id: string } | null) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue({ data: existingUser, error: null }),
  };
}

function makeRequest() {
  const req = new NextRequest(
    "https://rival.test/api/auth/bungie/callback?code=abc&state=valid-state"
  );
  req.cookies.set("bungie_oauth_state", "valid-state");
  return req;
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: "at", refresh_token: "rt", expires_in: 3600 }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        Response: {
          bungieNetUser: { membershipId: "user-1", uniqueName: "Guardian#1234" },
          destinyMemberships: [{ membershipId: "d-1", membershipType: 3 }],
          primaryMembershipId: "d-1",
        },
      }),
    }) as unknown as typeof fetch;
});

it("skips the shared signup-cap call entirely for an already-registered local user", async () => {
  mockFrom.mockImplementation((table: string) => {
    if (table === "users") return usersTableReturning({ id: "user-1" });
    throw new Error(`unexpected table: ${table}`);
  });

  const res = await GET(makeRequest());

  expect(mockReserveSignupSlot).not.toHaveBeenCalled();
  // Falls through to the (mocked-to-fail) token-encryption step, proving the
  // capacity gate did not block this known user.
  expect(res.headers.get("location")).toBe("https://rival.test/auth/error?error=encrypt_failed");
});

it("still consults the shared signup cap for a brand-new user and blocks when it's reached", async () => {
  mockFrom.mockImplementation((table: string) => {
    if (table === "users") return usersTableReturning(null);
    throw new Error(`unexpected table: ${table}`);
  });
  mockReserveSignupSlot.mockResolvedValue({
    status: "capacity_reached",
    allowed: false,
    already_registered: false,
    user_count: 150,
    max_users: 150,
  });

  const res = await GET(makeRequest());

  expect(mockReserveSignupSlot).toHaveBeenCalledWith("user-1");
  expect(res.headers.get("location")).toBe("https://rival.test/auth/error?error=signup_cap_reached");
});

it("does not lock out an existing user when the shared signup-cap sync throws", async () => {
  mockFrom.mockImplementation((table: string) => {
    if (table === "users") return usersTableReturning({ id: "user-1" });
    throw new Error(`unexpected table: ${table}`);
  });
  mockReserveSignupSlot.mockRejectedValue(new Error("capacity_backend_unavailable"));

  const res = await GET(makeRequest());

  expect(mockReserveSignupSlot).not.toHaveBeenCalled();
  expect(res.headers.get("location")).toBe("https://rival.test/auth/error?error=encrypt_failed");
});
