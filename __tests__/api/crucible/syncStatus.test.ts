/** @jest-environment node */
jest.mock("@/lib/auth/helpers", () => ({ requireSession: jest.fn() }));
jest.mock("@/lib/supabase/admin", () => ({ adminSupabase: { from: jest.fn() } }));

import { GET } from "@/app/api/crucible/sync-status/route";
import { requireSession } from "@/lib/auth/helpers";
import { adminSupabase } from "@/lib/supabase/admin";

const mockRequireSession = requireSession as jest.Mock;
const mockFrom = adminSupabase.from as jest.Mock;

function chainFor(result: { data?: unknown; error?: unknown; count?: number }) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: async () => ({ data: result.data ?? null, error: result.error ?? null }),
    then: (resolve: (value: { data: unknown; error: unknown; count?: number }) => void) =>
      resolve({ data: result.data ?? null, error: result.error ?? null, count: result.count }),
  };
  return builder;
}

describe("GET /api/crucible/sync-status", () => {
  beforeEach(() => {
    mockFrom.mockReset();
    mockRequireSession.mockReset();
  });

  it("returns the sync status and match count for the session user", async () => {
    mockRequireSession.mockResolvedValue({ userId: "user-1" });
    mockFrom.mockImplementation((table: string) => {
      if (table === "crucible_sync_state") return chainFor({ data: { status: "syncing" } });
      if (table === "crucible_encounters") return chainFor({ count: 42 });
      throw new Error(`unexpected table ${table}`);
    });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ status: "syncing", matchCount: 42 });
  });

  it("defaults to idle status and zero count when no rows exist", async () => {
    mockRequireSession.mockResolvedValue({ userId: "user-1" });
    mockFrom.mockImplementation((table: string) => {
      if (table === "crucible_sync_state") return chainFor({ data: null });
      if (table === "crucible_encounters") return chainFor({ count: null as unknown as number });
      throw new Error(`unexpected table ${table}`);
    });

    const res = await GET();
    const body = await res.json();

    expect(body).toEqual({ status: "idle", matchCount: 0 });
  });

  it("returns 401 when there is no session", async () => {
    mockRequireSession.mockRejectedValue(new Error("Unauthorized"));

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.ok).toBe(false);
  });
});
