import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/helpers";
import { queueCrucibleSync } from "@/lib/crucible/queueSync";
import { toClientErrorMessage } from "@/lib/api/errors";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const session = await requireSession();
    const state = await queueCrucibleSync(session.userId);
    return NextResponse.json({ ok: true, state });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to queue Crucible history";
    const status = message === "Unauthorized" ? 401 : 500;
    if (status === 500) console.error("[crucible/sync] request failed:", message);
    return NextResponse.json({ ok: false, error: toClientErrorMessage(message, status) }, { status });
  }
}

