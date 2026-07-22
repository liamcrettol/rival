/** @jest-environment node */
// A transient outage on Rerolled's side of the shared signup-capacity check
// must never lock an already-registered Rival user out of login: only
// genuinely new sign-ins should depend on that cross-service call.
import { NextRequest } from "next/server";

const mockFrom = jest.fn();
jest.mock("@/lib/supabase/admin", () => ({
  adminSupabase: { from: (...args: unknown[]) => mockFrom(...args) },
}));
jest.mock("@auth/core/jwt", () => ({ encode: jest.fn() }));
jest.mock("@/lib/auth/encrypt", () => ({ encryptToken: jest.fn().mockResolvedValue("enc") }));
// lib/crucible/sync.ts transitively imports the NextAuth config (lib/auth/index.ts),
// which pulls in @auth/core - an ESM package Jest can't parse. It's only used deep
// in the happy path this test never reaches (both tests stop at the users upsert),
// so a bare mock is enough to keep module resolution CJS-only.
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

// Non-transient so the route bails out right after the capacity gate with a
// stable, easy-to-assert-on redirect, instead of running the rest of the
// (unrelated, heavily-mocked) sign-in flow.
const USER_UPSERT_ERROR = { message: "duplicate key value violates unique constraint", code: "23505" };

function mockRouteUpToCapacity(existingAccountRow: { user_id: string } | null) {
  mockFrom.mockImplementation((table: string) => {
    if (table === "oauth_states") {
      return {
        select: () => ({ eq: () => ({ gt: () => ({ single: async () => ({ data: { state: "valid-state", return_to: null }, error: null }) }) }) }),
        delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
      };
    }
    if (table === "bungie_accounts") {
      return {
        select: () => ({ eq: () => ({ abortSignal: () => ({ maybeSingle: async () => ({ data: existingAccountRow, error: null }) }) }) }),
      };
    }
    if (table === "users") {
      return { upsert: () => ({ abortSignal: () => Promise.resolve({ error: USER_UPSERT_ERROR }) }) };
    }
    throw new Error(`unexpected table in this test: ${table}`);
  });
}

function mockOAuthFetches() {
  global.fetch = jest.fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: "at", refresh_token: "rt", expires_in: 3600 }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        Response: {
          bungieNetUser: { membershipId: "u1", uniqueName: "Guardian1" },
          destinyMemberships: [{ membershipId: "d1", membershipType: 3 }],
          primaryMembershipId: "d1",
        },
      }),
    }) as unknown as typeof fetch;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => {});
});

it("skips the cross-service capacity check entirely for a user with an existing Rival account", async () => {
  mockRouteUpToCapacity({ user_id: "u1" });
  mockOAuthFetches();
  // If this were called it would throw, proving the assertion below that it
  // was never invoked (not just that it happened to resolve favorably).
  mockReserveSignupSlot.mockRejectedValue(new Error("Rerolled is unreachable"));

  const res = await GET(new NextRequest("https://test.app/api/auth/bungie/callback?code=abc&state=valid-state"));

  expect(mockReserveSignupSlot).not.toHaveBeenCalled();
  expect(res.headers.get("location")).toBe("https://test.app/auth/error?error=user_upsert_failed");
});

it("still runs the capacity check for a genuinely new user, and fails closed if it errors", async () => {
  mockRouteUpToCapacity(null);
  mockOAuthFetches();
  mockReserveSignupSlot.mockRejectedValue(new Error("Rerolled is unreachable"));

  const res = await GET(new NextRequest("https://test.app/api/auth/bungie/callback?code=abc&state=valid-state"));

  expect(mockReserveSignupSlot).toHaveBeenCalledWith("u1");
  expect(res.headers.get("location")).toBe("https://test.app/auth/error?error=signup_cap_unavailable");
});

it("still lets a new user's successful capacity reservation proceed", async () => {
  mockRouteUpToCapacity(null);
  mockOAuthFetches();
  mockReserveSignupSlot.mockResolvedValue({ status: "available", allowed: true, already_registered: false, user_count: 10, max_users: 150 });

  const res = await GET(new NextRequest("https://test.app/api/auth/bungie/callback?code=abc&state=valid-state"));

  expect(mockReserveSignupSlot).toHaveBeenCalledWith("u1");
  expect(res.headers.get("location")).toBe("https://test.app/auth/error?error=user_upsert_failed");
});
