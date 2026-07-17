import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/helpers";
import { getMatchHallOfFame } from "@/lib/crucible/matchHallOfFame";

// This route can do a real inline Trials-K/D backfill (lib/crucible/
// matchHallOfFame.ts's inline top-up), which without an explicit maxDuration
// was getting killed by Vercel's much shorter platform default before its own
// ~25s internal fetch deadline ever finished - so most visits likely timed
// out rather than partially succeeding. Match the other background-heavy
// routes (sync-crucible, sync-trials-kd) that already set this.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const session = await requireSession();
    return NextResponse.json({ performances: await getMatchHallOfFame(session.userId) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load match hall of fame";
    return NextResponse.json({ error: message }, { status: message === "Unauthorized" ? 401 : 500 });
  }
}
