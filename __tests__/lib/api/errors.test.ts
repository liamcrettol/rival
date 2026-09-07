/** @jest-environment node */
import { toClientErrorMessage, UNEXPECTED_ERROR_MESSAGE } from "@/lib/api/errors";

describe("toClientErrorMessage", () => {
  it("returns a generic message for an unmapped (500) error", () => {
    expect(toClientErrorMessage("relation \"foo\" does not exist", 500)).toBe(UNEXPECTED_ERROR_MESSAGE);
  });

  it("passes through a deliberately-mapped status's message unchanged", () => {
    expect(toClientErrorMessage("Unauthorized", 401)).toBe("Unauthorized");
  });
});
