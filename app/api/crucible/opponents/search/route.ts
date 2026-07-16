import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/helpers";
import { searchOpponents } from "@/lib/crucible/opponentSearch";

const querySchema = z.object({ q: z.string().trim().min(2).max(64) });
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 30;
const searchWindows = new Map<string, { startedAt: number; count: number }>();

function consumeSearch(userId: string): boolean {
  const now = Date.now();
  const current = searchWindows.get(userId);
  if (!current || now - current.startedAt >= RATE_WINDOW_MS) {
    searchWindows.set(userId, { startedAt: now, count: 1 });
    return true;
  }
  if (current.count >= RATE_LIMIT) return false;
  current.count++;
  return true;
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    if (!consumeSearch(session.userId)) {
      return NextResponse.json(
        { error: "Too many player searches. Try again in a moment." },
        { status: 429, headers: { "Retry-After": "60" } },
      );
    }
    const { q } = querySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
    const results = await searchOpponents({ viewerUserId: session.userId, query: q });
    return NextResponse.json({ results });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Enter at least two characters" }, { status: 400 });
    const message = error instanceof Error ? error.message : "Unable to search players";
    return NextResponse.json({ error: message }, { status: message === "Unauthorized" ? 401 : 500 });
  }
}
