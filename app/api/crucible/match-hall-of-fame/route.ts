import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/helpers";
import { getMatchHallOfFame } from "@/lib/crucible/matchHallOfFame";

export async function GET() {
  try {
    const session = await requireSession();
    return NextResponse.json({ performances: await getMatchHallOfFame(session.userId) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load match hall of fame";
    return NextResponse.json({ error: message }, { status: message === "Unauthorized" ? 401 : 500 });
  }
}
