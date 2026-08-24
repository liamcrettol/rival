/** @jest-environment node */

const mockFetchLifetimeTrialsStats = jest.fn();
jest.mock("@/lib/bungie/trialsStats", () => ({
  fetchLifetimeTrialsStats: (...args: unknown[]) => mockFetchLifetimeTrialsStats(...args),
}));

const mockUpsertTrialsStats = jest.fn();
const mockRecordTrialsStatsFetchFailure = jest.fn();
jest.mock("@/lib/crucible/trialsStatsStore", () => {
  const actual = jest.requireActual("@/lib/crucible/trialsStatsStore");
  return {
    ...actual,
    upsertTrialsStats: (...args: unknown[]) => mockUpsertTrialsStats(...args),
    recordTrialsStatsFetchFailure: (...args: unknown[]) => mockRecordTrialsStatsFetchFailure(...args),
  };
});

import { refreshOpponents } from "@/lib/crucible/trialsBackfill";

const opponent = { membershipId: "opp-1", membershipType: 3 };
const quotaError = Object.assign(new Error("database reads limit exceeded for current billing cycle"), { code: 429 });

beforeEach(() => {
  jest.clearAllMocks();
  mockFetchLifetimeTrialsStats.mockResolvedValue({ kills: 1, deaths: 1, activitiesEntered: 1 });
  mockRecordTrialsStatsFetchFailure.mockResolvedValue(undefined);
});

it("updates and counts a successful write", async () => {
  mockUpsertTrialsStats.mockResolvedValue(undefined);

  const result = await refreshOpponents([opponent], { concurrency: 1 });

  expect(result).toMatchObject({ updated: 1, failed: 0, remaining: 0, quotaExhausted: false });
});

it("short-circuits the remaining batch when the Appwrite write quota is exhausted, without burning more Bungie calls", async () => {
  mockUpsertTrialsStats.mockRejectedValue(quotaError);
  const opponents = [opponent, { membershipId: "opp-2", membershipType: 3 }, { membershipId: "opp-3", membershipType: 3 }];

  const result = await refreshOpponents(opponents, { concurrency: 1 });

  expect(result.quotaExhausted).toBe(true);
  // Only the first candidate's Bungie fetch should run before the quota
  // signal stops the worker loop - the whole point of the short-circuit.
  expect(mockFetchLifetimeTrialsStats).toHaveBeenCalledTimes(1);
  // A doomed write-failure record isn't worth attempting on a quota error.
  expect(mockRecordTrialsStatsFetchFailure).not.toHaveBeenCalled();
});

it("still records a failure and keeps going for a non-quota write error", async () => {
  mockUpsertTrialsStats.mockRejectedValue(new Error("network timeout"));
  const opponents = [opponent, { membershipId: "opp-2", membershipType: 3 }];

  const result = await refreshOpponents(opponents, { concurrency: 1 });

  expect(result).toMatchObject({ updated: 0, failed: 2, remaining: 0, quotaExhausted: false });
  expect(mockRecordTrialsStatsFetchFailure).toHaveBeenCalledTimes(2);
});

it("still records a failure when the Bungie fetch itself throws", async () => {
  mockFetchLifetimeTrialsStats.mockRejectedValue(new Error("bungie 5xx"));

  const result = await refreshOpponents([opponent], { concurrency: 1 });

  expect(result).toMatchObject({ updated: 0, failed: 1, quotaExhausted: false });
  expect(mockUpsertTrialsStats).not.toHaveBeenCalled();
  expect(mockRecordTrialsStatsFetchFailure).toHaveBeenCalledTimes(1);
});
