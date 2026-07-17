"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, LoaderCircle, Trophy } from "lucide-react";
import { bungieImg } from "@/lib/destiny/constants";
import type { MatchHallOfFameEntry, MatchHallOfFamePlayer } from "@/lib/crucible/types";

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function RosterRow({ player }: { player: MatchHallOfFamePlayer }) {
  return <div className="flex min-h-[4.25rem] items-center border-b border-bungie-border/35 bg-bungie-dark/25 px-3 py-2.5 last:border-b-0">
    <div className={`min-w-0 flex-1 ${player.isCurrentUser ? "text-bungie-blue" : "text-white"}`}>
      <p className="truncate text-sm font-semibold">{player.displayName}</p>
      <div className="mt-1.5 flex items-baseline justify-between gap-2">
        <span className="font-mono text-[11px] text-gray-400">{player.kills ?? 0} K <span className="text-gray-700">/</span> {player.deaths ?? 0} D <span className="text-gray-700">/</span> {player.assists ?? 0} A</span>
        <span className="font-mono text-xs text-white">{player.kd === null ? "-" : player.kd.toFixed(2)} K/D</span>
      </div>
    </div>
  </div>;
}

function MatchCard({ match }: { match: MatchHallOfFameEntry }) {
  const image = bungieImg(match.mapImage) || null;
  const score = match.teamScore !== null || match.opponentScore !== null
    ? `${match.teamScore ?? "-"}-${match.opponentScore ?? "-"}`
    : null;
  const resultClass = match.result === "win" ? "border-green-500/35 bg-green-500/10 text-green-300" : match.result === "loss" ? "border-red-500/35 bg-red-500/10 text-red-300" : "border-bungie-border/70 bg-bungie-dark/50 text-gray-400";

  return <article className="border border-bungie-border/80 bg-bungie-dark/35">
    {image && <div className="relative h-32 w-full overflow-hidden border-b border-bungie-border">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={image} alt="" className="h-full w-full object-cover" /><div className="absolute inset-0 bg-black/45" /><div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-3"><div><span className={`border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.22em] ${resultClass}`}>{match.result}</span><span className="ml-2 text-[10px] font-bold uppercase tracking-[0.22em] text-gray-200">{match.mode}</span><h3 className="mt-2 text-xl font-semibold uppercase text-white">{match.map}</h3></div>{score && <div className="border border-white/25 bg-black/45 px-3 py-1.5 text-right font-mono text-lg text-white">{score}</div>}</div></div>}
    <div className="p-4">
      {!image && <div className="mb-4 flex items-start justify-between gap-3"><div><span className={`border px-2 py-1 text-[10px] font-bold uppercase tracking-[0.22em] ${resultClass}`}>{match.result}</span><span className="ml-2 text-[10px] font-bold uppercase tracking-[0.22em] text-gray-500">{match.mode}</span><h3 className="mt-3 text-lg font-semibold uppercase text-white">{match.map}</h3></div>{score && <div className="border border-bungie-border/70 px-3 py-2 text-right"><p className="text-[9px] uppercase tracking-wider text-gray-500">Score</p><p className="font-mono text-lg text-white">{score}</p></div>}</div>}
      <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs uppercase tracking-[0.22em] text-gray-500">{formatDate(match.playedAt)}</p><p className="mt-2 text-sm text-gray-300">Your performance: <span className="font-mono text-white">{match.kills} K / {match.deaths} D / {match.assists} A</span> ({match.kd.toFixed(2)} K/D)</p><p className="mt-1 text-xs text-gray-500">Qualified opponent: {match.opponentName} ({match.opponentKd.toFixed(2)} K/D)</p></div><a href={match.matchReportUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 border border-bungie-border/70 bg-bungie-dark/55 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-gray-400 transition hover:border-bungie-blue/60 hover:text-bungie-blue">Full match report <ArrowUpRight size={11} /></a></div>
      <div className="mt-4 grid gap-3 lg:grid-cols-2"><section className="border border-bungie-border/60 bg-bungie-dark/45"><div className="border-b border-bungie-border/55 px-3 py-2"><p className="section-label">Your Team</p></div>{match.team.map((player) => <RosterRow key={player.membershipId} player={player} />)}</section><section className="border border-bungie-border/60 bg-bungie-dark/45"><div className="border-b border-bungie-border/55 px-3 py-2"><p className="section-label">Opponents</p></div>{match.opponents.map((player) => <RosterRow key={player.membershipId} player={player} />)}</section></div>
    </div>
  </article>;
}

export default function MatchHallOfFame() {
  const [performances, setPerformances] = useState<MatchHallOfFameEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { const controller = new AbortController(); fetch("/api/crucible/match-hall-of-fame", { signal: controller.signal }).then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "Unable to load match hall of fame"); setPerformances(body.performances ?? []); }).catch((err) => { if ((err as Error).name !== "AbortError") setError(err instanceof Error ? err.message : "Unable to load match hall of fame"); }); return () => controller.abort(); }, []);
  if (error) return <p className="px-3 py-8 text-center text-xs text-red-300">{error}</p>;
  if (!performances) return <div className="flex items-center justify-center gap-2 py-10 text-xs text-gray-400"><LoaderCircle className="animate-spin text-bungie-blue" size={17} /> Loading your best games.</div>;
  if (performances.length === 0) return <div className="border border-bungie-border bg-bungie-dark/50 px-4 py-8 text-center"><Trophy className="mx-auto text-gray-600" size={24} /><p className="mt-3 text-sm font-semibold text-white">No qualifying performances yet</p><p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-gray-500">Public 3v3 wins with a 1.0+ K/D against an opponent with a 1.75+ lifetime Trials K/D will appear here once the shared stats cache has been populated.</p></div>;
  return <div className="space-y-3">{performances.map((match) => <MatchCard key={match.instanceId} match={match} />)}</div>;
}
