import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/helpers";
import { getMatchHallOfFame } from "@/lib/crucible/matchHallOfFame";

// Keep a generous ceiling for the history scan. Trials stats are populated by
// the background sync; this request only reads the bounded cached candidate set
// and must not fan out into a billing-sensitive backfill.
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
