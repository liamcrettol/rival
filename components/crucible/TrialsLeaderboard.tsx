"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, LoaderCircle, Skull } from "lucide-react";
import { bungieImg } from "@/lib/destiny/constants";
import type { TrialsRival } from "@/lib/crucible/types";

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function TrialsLeaderboard() {
  const [rivals, setRivals] = useState<TrialsRival[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/crucible/trials-leaderboard", { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Unable to load Trials leaderboard");
        setRivals(body.rivals ?? []);
      })
      .catch((err) => {
        if ((err as Error).name !== "AbortError") {
          setError(err instanceof Error ? err.message : "Unable to load Trials leaderboard");
        }
      });
    return () => controller.abort();
  }, []);

  if (error) {
    return <p className="px-3 py-8 text-center text-xs text-red-300">{error}</p>;
  }

  if (!rivals) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-xs text-gray-400">
        <LoaderCircle className="animate-spin text-bungie-blue" size={17} /> Loading the sweatiest opponents you have faced.
      </div>
    );
  }

  if (rivals.length === 0) {
    return (
      <div className="border border-bungie-border bg-bungie-dark/50 px-4 py-8 text-center">
        <Skull className="mx-auto text-gray-600" size={24} />
        <p className="mt-3 text-sm font-semibold text-white">No wins to show yet</p>
        <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-gray-500">
          Trials K/D for the players you have faced is fetched from Bungie in the background
          and fills in gradually. This list only shows opponents you have beaten at least once,
          so check back soon.
        </p>
      </div>
    );
  }

  return (
    <div className="border border-bungie-border bg-bungie-dark/35">
      <div className="divide-y divide-bungie-border/60">
        {rivals.map((rival) => (
          <div
            key={rival.membershipId}
            className="grid grid-cols-[1.25rem_2.25rem_1fr_auto_auto] items-center gap-3 px-3 py-2.5"
          >
            <span className="font-mono text-[11px] font-bold text-gray-600">#{rival.rank}</span>
            {bungieImg(rival.emblemPath) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={bungieImg(rival.emblemPath)} alt="" className="h-9 w-9 border border-white/10 object-cover" />
            ) : (
              <span className="flex h-9 w-9 items-center justify-center border border-white/10 bg-bungie-surface text-xs font-bold text-gray-600">
                {rival.displayName.slice(0, 1).toUpperCase()}
              </span>
            )}
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-white">{rival.displayName}</span>
              <span className="mt-0.5 flex items-center gap-2 text-[10px] text-gray-500">
                Last {formatDate(rival.lastPlayedAt)}
                {rival.matchReportUrl && (
                  <a
                    href={rival.matchReportUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-gray-500 transition hover:text-bungie-blue"
                  >
                    View win <ArrowUpRight size={10} />
                  </a>
                )}
              </span>
            </span>
            <span className="text-right">
              <span className="block font-mono text-sm font-bold text-bungie-blue">{rival.trialsKd.toFixed(2)} KD</span>
              <span className="mt-0.5 block text-[9px] uppercase tracking-wider text-gray-500">Their Trials record</span>
            </span>
            <span className="shrink-0 text-right font-mono text-[11px] font-bold text-green-300">
              {rival.wins}W
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
