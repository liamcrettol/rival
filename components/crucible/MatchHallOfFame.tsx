"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, LoaderCircle, Trophy } from "lucide-react";
import type { MatchHallOfFameEntry } from "@/lib/crucible/types";

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function MatchHallOfFame() {
  const [performances, setPerformances] = useState<MatchHallOfFameEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/crucible/match-hall-of-fame", { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Unable to load match hall of fame");
        setPerformances(body.performances ?? []);
      })
      .catch((err) => {
        if ((err as Error).name !== "AbortError") setError(err instanceof Error ? err.message : "Unable to load match hall of fame");
      });
    return () => controller.abort();
  }, []);

  if (error) return <p className="px-3 py-8 text-center text-xs text-red-300">{error}</p>;
  if (!performances) return <div className="flex items-center justify-center gap-2 py-10 text-xs text-gray-400"><LoaderCircle className="animate-spin text-bungie-blue" size={17} /> Loading your best games.</div>;
  if (performances.length === 0) return <div className="border border-bungie-border bg-bungie-dark/50 px-4 py-8 text-center"><Trophy className="mx-auto text-gray-600" size={24} /><p className="mt-3 text-sm font-semibold text-white">No qualifying performances yet</p><p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-gray-500">Public 3v3 games with at least 5 kills and a 1.75 K/D will appear here.</p></div>;

  return <div className="border border-bungie-border bg-bungie-dark/35"><div className="divide-y divide-bungie-border/60">{performances.map((match) => <div key={match.instanceId} className="grid grid-cols-[1.5rem_1fr_auto] items-center gap-3 px-4 py-3 sm:grid-cols-[1.5rem_1fr_auto_auto]">
    <span className="font-mono text-[11px] font-bold text-gray-600">#{match.rank}</span>
    <div className="min-w-0"><div className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className={`text-xs font-bold uppercase ${match.result === "win" ? "text-green-300" : match.result === "loss" ? "text-red-300" : "text-gray-300"}`}>{match.result}</span><span className="text-sm font-semibold text-white">{match.map}</span><span className="text-xs text-gray-500">{match.mode}</span></div><div className="mt-1 flex flex-wrap gap-x-3 text-[10px] text-gray-500"><span>{formatDate(match.playedAt)}</span><span>{match.kills}K / {match.deaths}D / {match.assists}A</span>{match.score && <span>Score {match.score}</span>}</div></div>
    <span className="text-right"><span className="block font-mono text-sm font-bold text-bungie-blue">{match.kd.toFixed(2)} K/D</span><span className="block text-[9px] uppercase tracking-wider text-gray-500">{match.kills} kills</span></span>
    <a href={match.matchReportUrl} target="_blank" rel="noreferrer" aria-label={`View match report for ${match.map}`} className="hidden items-center gap-1 text-xs text-gray-500 transition hover:text-bungie-blue sm:inline-flex">Report <ArrowUpRight size={12} /></a>
  </div>)}</div></div>;
}
