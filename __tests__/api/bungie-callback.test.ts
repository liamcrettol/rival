/** @jest-environment node */
// The OAuth callback must never gate a returning user's login on the shared
// (cross-service) new-signup capacity check - only genuinely new sign-ins
// need to reserve a lifetime slot from Rerolled.
import { NextRequest } from "next/server";

const mockFrom = jest.fn();
jest.mock("@/lib/supabase/admin", () => ({
  adminSupabase: { from: (...args: unknown[]) => mockFrom(...args) },
}));
jest.mock("@auth/core/jwt", () => ({ encode: jest.fn() }));
jest.mock("@/lib/auth/encrypt", () => ({ encryptToken: jest.fn() }));
jest.mock("@/lib/crucible/queueSync", () => ({ queueCrucibleSync: jest.fn().mockResolvedValue(null) }));
jest.mock("@/lib/crucible/sync", () => ({ materializeKnownCrucibleMatches: jest.fn() }));
const mockReserveSignupSlot = jest.fn();
jest.mock("@/lib/auth/signupCapacity", () => ({
  reserveSignupSlot: (...args: unknown[]) => mockReserveSignupSlot(...args),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let GET: (req: NextRequest) => Promise<any>;

beforeAll(() => {
  process.env.NEXTAUTH_URL = "https://test.app";
  process.env.BUNGIE_API_KEY = "test-key";
  process.env.BUNGIE_CLIENT_ID = "cid";
  process.env.BUNGIE_CLIENT_SECRET = "csecret";
  GET = require("@/app/api/auth/bungie/callback/route").GET;
});

const OAUTH_STATE_QUERY = {
  select: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  gt: jest.fn().mockReturnThis(),
  single: jest.fn().mockResolvedValue({ data: { state: "valid-state", return_to: null }, error: null }),
  delete: jest.fn().mockReturnThis(),
};

function mockSuccessfulBungieFetches() {
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
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("shared signup capacity gating (existing vs new users)", () => {
  it("skips the shared signup capacity check entirely for a user with an existing bungie_accounts row", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    mockSuccessfulBungieFetches();

    mockFrom.mockImplementation((table: string) => {
      if (table === "oauth_states") return OAUTH_STATE_QUERY;
      if (table === "bungie_accounts") {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({ data: { user_id: "user-1" }, error: null }),
        };
      }
      if (table === "users") {
        return {
          upsert: jest.fn().mockReturnValue({
            abortSignal: jest.fn().mockResolvedValue({ error: { message: "duplicate key value" } }),
          }),
        };
      }
      throw new Error(`unexpected table in this test: ${table}`);
    });

    const res = await GET(
      new NextRequest("https://test.app/api/auth/bungie/callback?code=abc&state=valid-state"),
    );

    expect(mockReserveSignupSlot).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toBe("https://test.app/auth/error?error=user_upsert_failed");
  });

  it("still enforces the shared signup capacity check for a brand-new user", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    mockSuccessfulBungieFetches();
    mockReserveSignupSlot.mockRejectedValue(new Error("capacity backend unavailable"));

    mockFrom.mockImplementation((table: string) => {
      if (table === "oauth_states") return OAUTH_STATE_QUERY;
      if (table === "bungie_accounts") {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
        };
      }
      throw new Error(`unexpected table in this test: ${table}`);
    });

    const res = await GET(
      new NextRequest("https://test.app/api/auth/bungie/callback?code=abc&state=valid-state"),
    );

    expect(mockReserveSignupSlot).toHaveBeenCalledWith("user-1");
    expect(res.headers.get("location")).toBe("https://test.app/auth/error?error=signup_cap_unavailable");
  });

  it("falls through to the capacity check when the local existing-account lookup itself fails", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    mockSuccessfulBungieFetches();
    mockReserveSignupSlot.mockRejectedValue(new Error("capacity backend unavailable"));

    mockFrom.mockImplementation((table: string) => {
      if (table === "oauth_states") return OAUTH_STATE_QUERY;
      if (table === "bungie_accounts") {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({ data: null, error: { message: "connection timed out" } }),
        };
      }
      throw new Error(`unexpected table in this test: ${table}`);
    });

    const res = await GET(
      new NextRequest("https://test.app/api/auth/bungie/callback?code=abc&state=valid-state"),
    );

    expect(mockReserveSignupSlot).toHaveBeenCalledWith("user-1");
    expect(res.headers.get("location")).toBe("https://test.app/auth/error?error=signup_cap_unavailable");
  });
});
