/** @jest-environment node */

import { reserveSignupSlot, releaseSignupSlot } from "@/lib/auth/signupCapacity";

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

  it("DELETEs the reservation for an orphaned user id", async () => {
    (global.fetch as jest.Mock).mockResolvedValue(response(200, { status: "ok" }));

    await releaseSignupSlot("orphaned-user");

    expect(global.fetch).toHaveBeenCalledWith(
      "https://rerolled.io/api/internal/rival/signup-capacity",
      expect.objectContaining({
        method: "DELETE",
        body: JSON.stringify({ userId: "orphaned-user" }),
      }),
    );
  });

  it("never throws, even when the request fails", async () => {
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    (global.fetch as jest.Mock).mockRejectedValue(new Error("network down"));

    await expect(releaseSignupSlot("orphaned-user")).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalledWith(
      "[signupCapacity] failed to release an orphaned slot",
      expect.objectContaining({ userId: "orphaned-user" }),
    );
    errSpy.mockRestore();
  });

  it("never throws when not configured", async () => {
    delete process.env.REROLLED_SYNC_BASE_URL;
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    await expect(releaseSignupSlot("orphaned-user")).resolves.toBeUndefined();
    expect(global.fetch).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("logs a non-2xx release response instead of silently treating it as released", async () => {
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    (global.fetch as jest.Mock).mockResolvedValue(response(401, { status: "temporary_verification_failure", error: { code: "unauthorized" } }));

    await releaseSignupSlot("orphaned-user");

    expect(errSpy).toHaveBeenCalledWith(
      "[signupCapacity] release request was not accepted",
      expect.objectContaining({ userId: "orphaned-user", status: 401 }),
    );
    errSpy.mockRestore();
  });
});
