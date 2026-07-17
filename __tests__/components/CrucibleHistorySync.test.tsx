import { render, waitFor } from "@testing-library/react";

const refreshMock = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

import CrucibleHistorySync from "@/components/CrucibleHistorySync";

function jsonResponse(body: unknown, ok = true) {
  return Promise.resolve({ ok, json: async () => body } as Response);
}

describe("CrucibleHistorySync", () => {
  beforeEach(() => {
    refreshMock.mockReset();
    sessionStorage.clear();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("polls sync-status while syncing and refreshes when the match count grows", async () => {
    const fetchMock = jest.fn()
      .mockImplementationOnce(() => jsonResponse({ imported: 0 })) // /api/crucible/refresh
      .mockImplementationOnce(() => jsonResponse({ status: "syncing", matchCount: 3 })) // initial status check
      .mockImplementationOnce(() => jsonResponse({ status: "syncing", matchCount: 8 })) // first poll: count grew
      .mockImplementationOnce(() => jsonResponse({ status: "complete", matchCount: 8 })); // second poll: done
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<CrucibleHistorySync />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/crucible/refresh", { method: "POST" });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/crucible/sync-status");

    await jest.advanceTimersByTimeAsync(15_000);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(refreshMock).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(15_000);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    // status flipped to "complete" with no new matches on this tick: no further refresh call
    expect(refreshMock).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(15_000);
    // polling stopped once status left queued/syncing
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("does not poll when the account is not mid-backfill", async () => {
    const fetchMock = jest.fn()
      .mockImplementationOnce(() => jsonResponse({ imported: 0 }))
      .mockImplementationOnce(() => jsonResponse({ status: "complete", matchCount: 40 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<CrucibleHistorySync />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await jest.advanceTimersByTimeAsync(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
