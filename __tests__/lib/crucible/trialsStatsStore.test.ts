import { isTrialsStatsQuotaError, isTrialsStatsUnavailableError } from "@/lib/crucible/trialsStatsStore";

describe("isTrialsStatsQuotaError", () => {
  it("recognizes Appwrite billing-cycle read exhaustion", () => {
    expect(isTrialsStatsQuotaError(new Error("Database reads limit for current billing cycle has been exceeded"))).toBe(true);
  });

  it("recognizes rate-limit failures", () => {
    expect(isTrialsStatsQuotaError(new Error("rate limit"))).toBe(true);
  });

  it("does not classify unrelated failures as quota errors", () => {
    expect(isTrialsStatsQuotaError(new Error("network timeout"))).toBe(false);
  });

  it("recognizes Appwrite's structured 429 error code regardless of message wording", () => {
    const error = Object.assign(new Error("Some future Appwrite wording"), { code: 429 });
    expect(isTrialsStatsQuotaError(error)).toBe(true);
  });

  it("does not match an unrelated structured error code", () => {
    const error = Object.assign(new Error("Document not found"), { code: 404 });
    expect(isTrialsStatsQuotaError(error)).toBe(false);
  });
});

describe("isTrialsStatsUnavailableError", () => {
  it("still recognizes every quota error isTrialsStatsQuotaError recognizes", () => {
    expect(isTrialsStatsUnavailableError(new Error("rate limit"))).toBe(true);
    expect(isTrialsStatsUnavailableError(Object.assign(new Error("x"), { code: 429 }))).toBe(true);
  });

  it("does not classify a plain, unrelated JS error as an Appwrite outage", () => {
    // getDatabases() hasn't run in this test file, so AppwriteExceptionRef is
    // still null - a TypeError/etc. here must never be mistaken for an
    // Appwrite-side failure just because the reference happens to be unset.
    expect(isTrialsStatsUnavailableError(new TypeError("cannot read properties of undefined"))).toBe(false);
  });
});
