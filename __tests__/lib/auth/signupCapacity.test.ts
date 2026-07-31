/** @jest-environment node */

import { releaseSignupSlot, reserveSignupSlot } from "@/lib/auth/signupCapacity";

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

describe("releaseSignupSlot", () => {
  beforeEach(() => {
    process.env.REROLLED_SYNC_BASE_URL = "https://rerolled.io";
    process.env.REROLLED_SYNC_SECRET = "secret";
    global.fetch = jest.fn() as unknown as typeof fetch;
  });

  it("sends a DELETE to Rerolled's internal endpoint", async () => {
    (global.fetch as jest.Mock).mockResolvedValue(response(200, { status: "released" }));

    await releaseSignupSlot("abandoned-user");

    expect(global.fetch).toHaveBeenCalledWith(
      "https://rerolled.io/api/internal/rival/signup-capacity",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("never throws, even when the request fails", async () => {
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    (global.fetch as jest.Mock).mockRejectedValue(new Error("network error"));

    await expect(releaseSignupSlot("abandoned-user")).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalledWith(
      "[signupCapacity] failed to release an abandoned signup slot",
      expect.objectContaining({ userId: "abandoned-user" }),
    );
    errSpy.mockRestore();
  });

  it("logs and returns when the shared secret is not configured", async () => {
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    delete process.env.REROLLED_SYNC_SECRET;

    await expect(releaseSignupSlot("abandoned-user")).resolves.toBeUndefined();
    expect(global.fetch).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
