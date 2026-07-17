"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// On-view Crucible sync. Fires once when the dashboard mounts (throttled across
// navigations via sessionStorage) to import the viewer's newest matches, then
// refreshes the server component if anything landed. The background cron
// (sync-crucible) owns the deep-history backfill cursor; this only tops up the
// newest page, so the two never race.
const THROTTLE_MS = 90_000;
const STORAGE_KEY = "crucible-sync-at";

// While a backfill is actively in progress, poll the cheap status endpoint
// and refresh the page when new matches land or the backfill finishes, so
// the panel visibly grows instead of requiring a manual reload. Bounded so an
// abandoned tab doesn't poll forever.
const POLL_INTERVAL_MS = 15_000;
const POLL_MAX_DURATION_MS = 10 * 60_000;

interface SyncStatusResponse {
  status?: "idle" | "queued" | "syncing" | "complete" | "failed";
  matchCount?: number;
}

export default function CrucibleHistorySync() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    function pollWhileSyncing(startedAt: number, lastMatchCount: number) {
      if (cancelled || Date.now() - startedAt > POLL_MAX_DURATION_MS) return;
      pollTimer = setTimeout(async () => {
        if (cancelled) return;
        try {
          const res = await fetch("/api/crucible/sync-status");
          if (!res.ok) return;
          const data = (await res.json()) as SyncStatusResponse;
          const matchCount = data.matchCount ?? lastMatchCount;
          const status = data.status ?? "idle";
          if (matchCount > lastMatchCount) router.refresh();
          if (status === "queued" || status === "syncing") {
            pollWhileSyncing(startedAt, matchCount);
          }
        } catch {
          // best-effort; try again next tick until the cap is reached
          pollWhileSyncing(startedAt, lastMatchCount);
        }
      }, POLL_INTERVAL_MS);
    }

    let last = 0;
    try {
      last = Number(sessionStorage.getItem(STORAGE_KEY) ?? 0);
    } catch {
      // sessionStorage can throw in private modes; fall through and sync anyway.
    }
    if (Date.now() - last < THROTTLE_MS) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, String(Date.now()));
    } catch {
      // ignore write failures; worst case we sync a little more often
    }

    (async () => {
      try {
        const res = await fetch("/api/crucible/refresh", { method: "POST" });
        if (!res.ok) return;
        const data = (await res.json()) as { imported?: number };
        if (!cancelled && (data.imported ?? 0) > 0) router.refresh();
      } catch {
        // best-effort; the background cron still backfills history
      } finally {
        try {
          const statusRes = await fetch("/api/crucible/sync-status");
          if (statusRes.ok) {
            const statusData = (await statusRes.json()) as SyncStatusResponse;
            if ((statusData.status === "queued" || statusData.status === "syncing") && !cancelled) {
              pollWhileSyncing(Date.now(), statusData.matchCount ?? 0);
            }
          }
        } catch {
          // status polling is a nicety; the cron still backfills regardless
        }
      }
    })();

    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, [router]);

  return null;
}
