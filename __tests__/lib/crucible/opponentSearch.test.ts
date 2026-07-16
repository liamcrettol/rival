/** @jest-environment node */
import { flattenBungieSearchResults } from "@/lib/crucible/opponentSearch";

const details = [{
  bungieGlobalDisplayName: "Guardian",
  bungieGlobalDisplayNameCode: 42,
  destinyMemberships: [
    {
      membershipId: "100",
      membershipType: 3,
      displayName: "old-steam-name",
      crossSaveOverride: 1,
      applicableMembershipTypes: [],
    },
    {
      membershipId: "200",
      membershipType: 1,
      displayName: "current-xbox-name",
      crossSaveOverride: 1,
      applicableMembershipTypes: [1, 3],
    },
  ],
}];

describe("flattenBungieSearchResults", () => {
  it("returns the active cross-save membership and formats the discriminator", () => {
    expect(flattenBungieSearchResults(details, "Guardian")).toEqual([
      expect.objectContaining({
        membershipId: "200",
        membershipType: 1,
        displayName: "Guardian#0042",
        platformDisplayName: "current-xbox-name",
      }),
    ]);
  });

  it("filters exact Name#code searches after searching the name prefix", () => {
    expect(flattenBungieSearchResults(details, "Guardian#0042")).toHaveLength(1);
    expect(flattenBungieSearchResults(details, "Guardian#0043")).toHaveLength(0);
  });

  it("rejects malformed membership ids", () => {
    const malformed = [{ ...details[0], destinyMemberships: [{ membershipId: "not-a-number" }] }];
    expect(flattenBungieSearchResults(malformed, "Guardian")).toEqual([]);
  });
});
