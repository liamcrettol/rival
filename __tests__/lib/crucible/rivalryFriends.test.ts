jest.mock("@/lib/auth/helpers", () => ({ getBungieToken: jest.fn() }));
jest.mock("@/lib/bungie/client", () => ({ bungieGet: jest.fn() }));

import { extractFriendMembershipIds } from "@/lib/crucible/rivalryFriends";

describe("extractFriendMembershipIds", () => {
  it("deduplicates valid Destiny memberships and excludes the viewer", () => {
    expect(extractFriendMembershipIds([
      { lastSeenAsMembershipId: "123" },
      { lastSeenAsMembershipId: "123" },
      { lastSeenAsMembershipId: "456" },
      { lastSeenAsMembershipId: "999" },
      { lastSeenAsMembershipId: "not-a-membership" },
      {},
    ], "999")).toEqual(["123", "456"]);
  });
});
