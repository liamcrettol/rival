/** @jest-environment node */

import { hasExistingBungieAccount, reserveSignupSlot, type SignupCapacityDb } from "@/lib/auth/signupCapacity";

function makeAccountsDb(config: { row: { user_id: string } | null; error?: unknown; throws?: boolean }): SignupCapacityDb {
  return {
    from(table: string) {
      expect(table).toBe("bungie_accounts");
      return {
        select: (columns: string) => {
          expect(columns).toBe("user_id");
          return {
            eq: () => ({
              maybeSingle: async () => {
                if (config.throws) throw new Error("connection reset");
                return { data: config.row, error: config.error ?? null };
              },
            }),
          };
        },
      };
    },
  };
}

function response(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const available = {
  status: "available",
  allowed: true,
  already_registered: false,
  user_count: 8,
  max_users: 150,
};

describe("shared signup capacity bridge", () => {
  beforeEach(() => {
    process.env.REROLLED_SYNC_BASE_URL = "https://rerolled.io";
    process.env.REROLLED_SYNC_SECRET = "secret";
    global.fetch = jest.fn() as unknown as typeof fetch;
  });

  it("accepts an available response", async () => {
    (global.fetch as jest.Mock).mockResolvedValue(response(200, available));

    await expect(reserveSignupSlot("new-user")).resolves.toEqual(available);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("accepts an already-registered response", async () => {
    const existing = { ...available, status: "already_registered", already_registered: true };
    (global.fetch as jest.Mock).mockResolvedValue(response(200, existing));

    await expect(reserveSignupSlot("existing-user")).resolves.toEqual(existing);
  });

  it("surfaces capacity reached without retrying or bypassing it", async () => {
    const full = {
      status: "capacity_reached",
      allowed: false,
      already_registered: false,
      user_count: 150,
      max_users: 150,
    };
    (global.fetch as jest.Mock).mockResolvedValue(response(409, full));

    await expect(reserveSignupSlot("new-user")).resolves.toEqual(full);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("retries a transient API failure, then succeeds", async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(response(503, { status: "temporary_verification_failure", error: { code: "capacity_backend_unavailable" } }))
      .mockResolvedValueOnce(response(200, available));

    await expect(reserveSignupSlot("new-user")).resolves.toEqual(available);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("fails closed on malformed responses", async () => {
    (global.fetch as jest.Mock).mockResolvedValue(response(200, { allowed: true }));

    await expect(reserveSignupSlot("new-user")).rejects.toThrow("malformed_capacity_response");
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("retries a timeout, then fails closed", async () => {
    (global.fetch as jest.Mock).mockRejectedValue(
      new DOMException("The operation timed out", "TimeoutError"),
    );

    await expect(reserveSignupSlot("new-user")).rejects.toThrow("capacity_request_timeout");
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});

describe("hasExistingBungieAccount", () => {
  it("returns true when the user already has a linked bungie_accounts row", async () => {
    const db = makeAccountsDb({ row: { user_id: "existing-user" } });

    await expect(hasExistingBungieAccount("existing-user", db)).resolves.toBe(true);
  });

  it("returns false for a brand-new user with no linked row", async () => {
    const db = makeAccountsDb({ row: null });

    await expect(hasExistingBungieAccount("new-user", db)).resolves.toBe(false);
  });

  it("falls through to false (cross-service check) on a database error, not a false positive", async () => {
    const db = makeAccountsDb({ row: null, error: { message: "boom" } });

    await expect(hasExistingBungieAccount("some-user", db)).resolves.toBe(false);
  });

  it("falls through to false (cross-service check) if the lookup throws", async () => {
    const db = makeAccountsDb({ row: null, throws: true });

    await expect(hasExistingBungieAccount("some-user", db)).resolves.toBe(false);
  });
});
