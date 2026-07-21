import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import MatchHistoryPanel from "@/components/MatchHistoryPanel";
import CrucibleHistorySync from "@/components/CrucibleHistorySync";
import BrandMark from "@/components/BrandMark";
import RerolledNavLink from "@/components/RerolledNavLink";
import SignOutButton from "@/components/SignOutButton";
import { getCrucibleMatchHistory } from "@/lib/crucible/matchHistory";
import { queueCrucibleSync } from "@/lib/crucible/queueSync";
import {
  claimCrucibleSyncForUser,
  materializeKnownCrucibleMatches,
  syncNextCrucibleHistoryPage,
} from "@/lib/crucible/sync";
import OpponentSearch from "@/components/crucible/OpponentSearch";

export const dynamic = "force-dynamic";
// A first-ever sign-in now runs one real backfill page synchronously below
// (Bungie + PGCR fetches), so give this route the same headroom as the
// cron/refresh routes that do the same kind of work.
export const maxDuration = 30;

export default async function Dashboard() {
  const session = await auth();
  if (!session?.userId) redirect("/");

  // Sequential, not Promise.all: this is the recovery path for the case the
  // OAuth callback's own queue+materialize work didn't finish before the login
  // redirect (a real possibility in a serverless invocation). Enrolling the
  // sync-state row must land before materializing, and materializing must land
  // before the history read, or the read can race ahead of both writes.
  const state = await queueCrucibleSync(session.userId).catch(() => null);
  if (state) await materializeKnownCrucibleMatches(session.userId).catch(() => {});

  // First-ever sign-in only (never backfilled, never incrementally synced):
  // run one real backfill page synchronously so the first dashboard paint
  // already shows more than just the newest handful of games, instead of
  // waiting on the next 10-minute cron tick. Claimed via a user-scoped
  // conditional update so this can never race the cron's own queue-wide
  // claim; a lost race is just a zero-row no-op and we fall back to the cron.
  const isFirstEverSync = state?.status === "queued"
    && !state.backfill_completed_at
    && !state.last_incremental_sync_at;
  if (isFirstEverSync) {
    const claimed = await claimCrucibleSyncForUser(session.userId, `dashboard-${session.userId}`)
      .catch(() => null);
    if (claimed) await syncNextCrucibleHistoryPage(session.userId).catch(() => {});
  }

  const history = await getCrucibleMatchHistory(session.userId, { limit: 15 }).catch(() => ({
    matches: [],
    syncStatus: "idle" as const,
  }));

  return (
    <div className="min-h-screen bg-bungie-dark">
      <header className="border-b border-bungie-border">
        <div className="mx-auto flex h-[4.5rem] max-w-7xl items-center gap-6 px-4 sm:px-6">
          <span className="flex items-center gap-2.5">
            <BrandMark className="h-7 w-7" />
            <span className="text-xl font-bold uppercase tracking-[0.12em]">Rival</span>
          </span>
          <RerolledNavLink />
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-sm font-semibold text-gray-300 sm:block">
              {session.displayName}
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <CrucibleHistorySync />
        <OpponentSearch>
          <MatchHistoryPanel matches={history.matches} syncStatus={history.syncStatus} />
        </OpponentSearch>
      </main>
    </div>
  );
}
