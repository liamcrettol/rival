/** @jest-environment node */
import { raceTimeout } from "@/lib/appwrite/timeout";

describe("raceTimeout", () => {
  it("resolves with the promise's value when it settles before the timeout", async () => {
    await expect(raceTimeout(Promise.resolve("ok"), 1_000, "op")).resolves.toBe("ok");
  });

  it("propagates the promise's rejection when it rejects before the timeout", async () => {
    await expect(raceTimeout(Promise.reject(new Error("boom")), 1_000, "op")).rejects.toThrow("boom");
  });

  it("rejects with a timeout error once the deadline elapses, even if the promise never settles", async () => {
    const neverSettles = new Promise(() => {});
    await expect(raceTimeout(neverSettles, 10, "getDocument")).rejects.toThrow("getDocument timed out after 10ms");
  });

  it("uses the provided error factory for the timeout rejection", async () => {
    class CustomTimeoutError extends Error {}
    const neverSettles = new Promise(() => {});
    await expect(
      raceTimeout(neverSettles, 10, "createFile", (message) => new CustomTimeoutError(message))
    ).rejects.toBeInstanceOf(CustomTimeoutError);
  });
});
