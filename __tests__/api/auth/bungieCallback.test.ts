/** @jest-environment node */
jest.mock("@/lib/supabase/admin", () => ({ adminSupabase: { from: jest.fn() } }));
jest.mock("@/lib/auth/encrypt", () => ({ encryptToken: jest.fn(async (t: string) => `enc:${t}`) }));
jest.mock("@auth/core/jwt", () => ({ encode: jest.fn(async () => "session-jwt") }));
jest.mock("@/lib/crucible/queueSync", () => ({ queueCrucibleSync: jest.fn(async () => null) }));
jest.mock("@/lib/crucible/sync", () => ({ materializeKnownCrucibleMatches: jest.fn(async () => undefined) }));
jest.mock("@/lib/auth/signupCapacity", () => ({ reserveSignupSlot: jest.fn() }));

import { NextRequest } from "next/server";
import { adminSupabase } from "@/lib/supabase/admin";
import { reserveSignupSlot } from "@/lib/auth/signupCapacity";

const mockFrom = adminSupabase.from as jest.Mock;
const mockReserveSignupSlot = reserveSignupSlot as jest.Mock;

// BASE_URL is resolved from NEXTAUTH_URL at module import time, so env vars
// must be set before the route module loads (matches Rerolled's callback test).
process.env.NEXTAUTH_URL = "https://rival.rerolled.io";
process.env.BUNGIE_API_KEY = "api-key";
process.env.BUNGIE_CLIENT_ID = "client-id";
process.env.BUNGIE_CLIENT_SECRET = "client-secret";
process.env.NEXTAUTH_SECRET = "next-auth-secret";
process.env.TOKEN_ENCRYPTION_KEY = "0".repeat(64);

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { GET } = require("@/app/api/auth/bungie/callback/route");

function chainFor(result: { data?: unknown; error?: unknown }) {
  const builder: Record<string, unknown> = {
    select: () => builder,
    upsert: () => builder,
    eq: () => builder,
    abortSignal: () => builder,
    maybeSingle: async () => ({ data: result.data ?? null, error: result.error ?? null }),
    then: (resolve: (value: { data: unknown; error: unknown }) => void) =>
      resolve({ data: result.data ?? null, error: result.error ?? null }),
  };
  return builder;
}

function bungieFetchMock() {
  return jest.fn(async (url: string) => {
    if (url.includes("/OAuth/token/")) {
      return {
        ok: true,
        text: async () => "",
        json: async () => ({ access_token: "at", refresh_token: "rt", expires_in: 3600 }),
      };
    }
    if (url.includes("GetMembershipsForCurrentUser")) {
      return {
        ok: true,
        json: async () => ({
          Response: {
            bungieNetUser: { membershipId: "bnet-1", uniqueName: "Guardian#1234" },
            destinyMemberships: [{ membershipId: "dest-1", membershipType: 3 }],
            primaryMembershipId: "dest-1",
          },
        }),
      };
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as unknown as typeof fetch;
}

function callbackRequest() {
  return new NextRequest("https://rival.rerolled.io/api/auth/bungie/callback?code=abc&state=xyz", {
    headers: { cookie: "bungie_oauth_state=xyz; bungie_oauth_return_to=%2Fdashboard" },
  });
}

describe("GET /api/auth/bungie/callback signup capacity gating", () => {
  beforeEach(() => {
    mockFrom.mockReset();
    mockReserveSignupSlot.mockReset();
    global.fetch = bungieFetchMock();
  });

  it("skips the shared capacity check entirely for a returning user", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "bungie_accounts") return chainFor({ data: { user_id: "bnet-1" } });
      if (table === "users") return chainFor({ data: null });
      throw new Error(`unexpected table ${table}`);
    });

    const res = await GET(callbackRequest());

    expect(mockReserveSignupSlot).not.toHaveBeenCalled();
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://rival.rerolled.io/dashboard");
  });

  it("does not lock out a returning user when the shared capacity backend is unreachable", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "bungie_accounts") return chainFor({ data: { user_id: "bnet-1" } });
      if (table === "users") return chainFor({ data: null });
      throw new Error(`unexpected table ${table}`);
    });
    mockReserveSignupSlot.mockRejectedValue(new Error("Shared signup capacity verification failed: capacity_backend_unavailable"));

    const res = await GET(callbackRequest());

    expect(mockReserveSignupSlot).not.toHaveBeenCalled();
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://rival.rerolled.io/dashboard");
  });

  it("still runs the shared capacity check for a genuinely new user", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "bungie_accounts") return chainFor({ data: null });
      if (table === "users") return chainFor({ data: null });
      throw new Error(`unexpected table ${table}`);
    });
    mockReserveSignupSlot.mockResolvedValue({
      status: "available",
      allowed: true,
      already_registered: false,
      user_count: 8,
      max_users: 150,
    });

    const res = await GET(callbackRequest());

    expect(mockReserveSignupSlot).toHaveBeenCalledWith("bnet-1");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://rival.rerolled.io/dashboard");
  });

  it("still blocks a genuinely new user when the shared cap is reached", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "bungie_accounts") return chainFor({ data: null });
      throw new Error(`unexpected table ${table}`);
    });
    mockReserveSignupSlot.mockResolvedValue({
      status: "capacity_reached",
      allowed: false,
      already_registered: false,
      user_count: 150,
      max_users: 150,
    });

    const res = await GET(callbackRequest());

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://rival.rerolled.io/auth/error?error=signup_cap_reached");
  });

  it("falls back to the shared capacity check when the local existing-account lookup errors", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "bungie_accounts") {
        // The existence check (maybeSingle) errors, but the later upsert write
        // (then) must still succeed so this test isolates the fallback behavior.
        const builder = chainFor({ data: null });
        builder.maybeSingle = jest.fn(async () => ({ data: null, error: { message: "db blip" } }));
        return builder;
      }
      if (table === "users") return chainFor({ data: null });
      throw new Error(`unexpected table ${table}`);
    });
    mockReserveSignupSlot.mockResolvedValue({
      status: "available",
      allowed: true,
      already_registered: false,
      user_count: 8,
      max_users: 150,
    });

    const res = await GET(callbackRequest());

    expect(mockReserveSignupSlot).toHaveBeenCalledWith("bnet-1");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://rival.rerolled.io/dashboard");
  });
});
