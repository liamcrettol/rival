import { isPlaceholderPlayerName } from "@/lib/crucible/playerIdentity";

describe("isPlaceholderPlayerName", () => {
  it("recognizes bare PGCR placeholders", () => {
    expect(isPlaceholderPlayerName("Guardian")).toBe(true);
    expect(isPlaceholderPlayerName(" destiny ")).toBe(true);
    expect(isPlaceholderPlayerName("")).toBe(true);
  });

  it("preserves legitimate Bungie global names with discriminators", () => {
    expect(isPlaceholderPlayerName("Guardian#0042")).toBe(false);
    expect(isPlaceholderPlayerName("Yunizma")).toBe(false);
  });
});
