import { isTrialsStatsQuotaError } from "@/lib/crucible/trialsStatsStore";

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
});
