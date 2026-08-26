import { render, waitFor, screen } from "@testing-library/react";

import MatchHallOfFame from "@/components/crucible/MatchHallOfFame";

function jsonResponse(body: unknown, ok = true) {
  return Promise.resolve({ ok, json: async () => body } as Response);
}

const MATCH = {
  instanceId: "1",
  playedAt: "2026-08-01T00:00:00Z",
  map: "Midtown",
  mode: "Trials of Osiris",
  result: "win" as const,
  teamScore: 5,
  opponentScore: 3,
  mapImage: null,
  kills: 10,
  deaths: 2,
  assists: 1,
  kd: 5,
  opponentName: "Rival#1234",
  opponentKd: 1.8,
  opponentTrialsReportUrl: "https://trials.report/x",
  matchReportUrl: "https://trials.report/y",
  team: [],
  opponents: [],
};

describe("MatchHallOfFame", () => {
  // Found during the 2026-08-26 production health audit: the backend
  // correctly serves cached entries with degraded:true during an Appwrite
  // read-quota outage, but the component only surfaced `degraded` in the
  // empty-state branch - a non-empty cached result rendered with no
  // indication the data might be stale.
  it("shows a stale-data notice when serving cached entries during a degraded fetch", async () => {
    global.fetch = jest.fn(() => jsonResponse({ performances: [MATCH], degraded: true })) as unknown as typeof fetch;

    render(<MatchHallOfFame />);

    await waitFor(() => expect(screen.getByText(/still updating/i)).toBeInTheDocument());
  });

  it("shows no stale-data notice for a fresh, non-degraded fetch", async () => {
    global.fetch = jest.fn(() => jsonResponse({ performances: [MATCH], degraded: false })) as unknown as typeof fetch;

    render(<MatchHallOfFame />);

    await waitFor(() => expect(screen.getByText("Midtown")).toBeInTheDocument());
    expect(screen.queryByText(/still updating/i)).not.toBeInTheDocument();
  });
});
