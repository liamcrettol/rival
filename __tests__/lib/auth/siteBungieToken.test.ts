/** @jest-environment node */
// Found during the 2026-08-26 production health audit: getSiteBungieToken's
// fetch to Rerolled's token bridge carried no AbortSignal, unlike every other
// cross-service/Supabase call in this codebase - a stalled bridge endpoint
// (cold start, DB hang) would hang this request indefinitely instead of
// failing fast for a public_history_sync ("site roster mirror") account.
jest.mock("@/lib/auth", () => ({ auth: jest.fn(async () => null) }));
jest.mock("@/lib/auth/encrypt", () => ({
  decryptToken: jest.fn(async (enc: string) => enc.replace(/^enc:/, "")),
  encryptToken: jest.fn(async (token: string) => `enc:${token}`),
}));
jest.mock("@/lib/supabase/admin", () => ({
  withSupabaseTimeout: (p: unknown) => p,
  adminSupabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: {
              user_id: "user-1",
              membership_id: "d1",
              public_history_sync: true,
              access_token_enc: null,
              refresh_token_enc: null,
              expires_at: null,
              oauth_client_id: null,
            },
          }),
        }),
      }),
    }),
  },
}));

import { getBungieToken } from "@/lib/auth/helpers";

describe("getSiteBungieToken", () => {
  beforeEach(() => {
    process.env.REROLLED_SYNC_BASE_URL = "https://rerolled.io";
    process.env.REROLLED_SYNC_SECRET = "shared-secret";
  });

  it("bounds the token-bridge request with an AbortSignal", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ accessToken: "site-access-token" }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const token = await getBungieToken("user-1");

    expect(token).toBe("site-access-token");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});
