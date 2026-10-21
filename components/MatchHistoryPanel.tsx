// Match history panel. Ported from Rerolled's SeasonPanel (rerolled@e07d865);
// season-aggregate tiles were left behind. Rival renders imported Crucible matches with per-opponent
// head-to-head chips.
import { RefreshCw } from "lucide-react";
import type { SeasonMatch, SeasonMatchPlayer } from "@/types/platform";
import HeadToHeadChip from "@/components/crucible/HeadToHeadChip";
import { crucibleGameReportUrl, crucibleModeLabel } from "@/lib/crucible/modes";
import LocalDateTime from "@/components/platform/LocalDateTime";
import { bungieImg } from "@/lib/destiny/constants";
import type { SeasonStatsSyncStatus } from "@/lib/crucible/matchHistory";

function formatKd(value: number | null) {
  return value === null ? "-" : value.toFixed(2);
}

function RosterRow({ player }: { player: SeasonMatchPlayer }) {
  const emblemUrl = bungieImg(player.emblemPath) || null;

  return (
    <div className="relative isolate flex min-h-[4.25rem] items-center overflow-hidden border-b border-bungie-border/35 bg-bungie-dark/25 py-2.5 pl-16 pr-3 transition last:border-b-0 hover:bg-bungie-dark/55">
      {emblemUrl && (
        <div
          aria-hidden="true"
          className="absolute left-1.5 top-1/2 -z-10 h-11 w-11 -translate-y-1/2 border border-white/10 bg-cover bg-center"
          style={{ backgroundImage: `url(${emblemUrl})` }}
        />
      )}
      {!emblemUrl && (
        <div aria-hidden="true" className="absolute left-1.5 top-1/2 -z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center border border-white/10 bg-bungie-surface text-lg font-semibold text-gray-600">
          {player.displayName.slice(0, 1).toUpperCase()}
        </div>
      )}
      <div className="absolute inset-y-0 left-14 -z-10 w-6   " />
      {player.headToHead && (
        <div className="absolute right-2 top-2 z-10">
          <HeadToHeadChip summary={player.headToHead} opponentName={player.displayName} />
        </div>
      )}
      <div className="min-w-0 flex-1 pr-12">
        {player.trialsReportUrl ? (
          <a
            href={player.trialsReportUrl}
            target="_blank"
            rel="noreferrer"
            className={`group inline-flex min-w-0 max-w-full items-center gap-1.5 font-semibold transition hover:text-bungie-blue ${player.isCurrentUser ? "text-bungie-blue" : "text-white"}`}
            aria-label={`Open ${player.displayName} on Trials Report`}
          >
            <span className="truncate text-sm">{player.displayName}</span>
            <span className="inline-flex shrink-0 items-center gap-0.5 text-xs   text-gray-500 transition group-hover:text-bungie-blue">
              Profile
            </span>
          </a>
        ) : (
          <p className={`truncate text-sm font-semibold ${player.isCurrentUser ? "text-bungie-blue" : "text-white"}`}>{player.displayName}</p>
        )}
        <div className="mt-1.5 flex items-baseline justify-between gap-2">
          <span className="flex items-center gap-1.5 whitespace-nowrap tabular-nums text-[11px] text-gray-400">
            <span><span className="text-gray-100">{player.kills ?? 0}</span> K</span>
            <span className="text-gray-700">/</span>
            <span><span className="text-gray-100">{player.deaths ?? 0}</span> D</span>
            <span className="text-gray-700">/</span>
            <span><span className="text-gray-100">{player.assists ?? 0}</span> A</span>
          </span>
          <span className="shrink-0 tabular-nums text-xs text-white">{formatKd(player.kd)} K/D</span>
        </div>
      </div>
    </div>
  );
}

export function MatchCard({ match }: { match: SeasonMatch }) {
  const loadout = match.loadout.filter((slot) => slot.icon || slot.name);
  const mapImage = bungieImg(match.mapImage) || null;
  const resultLabel = match.result === "win" ? "Win" : match.result === "loss" ? "Loss" : "Report";
  const modeLabel = match.mode === "crucible"
    ? (match.modeName ?? (match.modeBucket ? crucibleModeLabel(match.modeBucket) : "Crucible"))
    : match.mode === "weekly_challenge" ? "Weekly Challenge" : "Score Attack";
  const hasScore = match.teamScore !== null || match.opponentScore !== null;
  const scoreText = `${match.teamScore ?? "-"}${match.opponentScore !== null ? `-${match.opponentScore}` : ""}`;
  const fullReportUrl = match.mode === "crucible" && match.instanceId
    ? crucibleGameReportUrl(match.instanceId, match.modeBucket)
    : null;
  const rerolledLabel = match.rerolledMode === "draft"
    ? "Draft"
    : match.rerolledMode === "loadout_roulette" ? "Loadout roulette" : null;

  return (
    <article className="border-b border-bungie-border py-8">
      {mapImage && <div className="mb-5 aspect-video max-h-48 overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={mapImage} alt="" className="h-full w-full object-cover" />
      </div>}
      <div>
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-gray-400">{resultLabel} | {modeLabel}{rerolledLabel ? ` | ${rerolledLabel}` : ""}</p>
            <h3 className="mt-2 text-lg font-semibold">{match.activityName}</h3>
          </div>
          {hasScore && <div className="text-right"><p className="text-sm text-gray-400">Score</p><p className="tabular-nums text-lg">{scoreText}</p></div>}
        </div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs   text-gray-500">
              <LocalDateTime value={match.playedAt} />
              {match.challengeTitle ? ` / ${match.challengeTitle}` : ""}
            </p>
            {match.featuredPlayerLabel && (
              <p className="mt-3 text-sm text-gray-300">{match.featuredPlayerLabel}</p>
            )}
          </div>
          {fullReportUrl && (
            <a
              href={fullReportUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 border border-bungie-border/70 bg-bungie-dark/55 px-2.5 py-1.5 text-sm font-bold   text-gray-400 transition hover:border-bungie-blue/60 hover:text-bungie-blue"
            >
              Full match report
            </a>
          )}
        </div>

      {loadout.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {loadout.map((slot) => {
            const icon = bungieImg(slot.icon) || null;
            return (
              <div key={slot.slot} className="flex items-center gap-2  px-2.5 py-2">
                {icon ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={icon} alt="" className="h-8 w-8 shrink-0 bg-black/20 object-cover" />
                ) : (
                  <div className="h-8 w-8 shrink-0 bg-bungie-dark" />
                )}
                <div className="min-w-0">
                  <p className="text-sm font-bold   text-gray-500">{slot.slot}</p>
                  <p className="truncate text-xs font-medium text-white">{slot.name}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className={`mt-4 grid gap-3 ${match.opponents.length > 0 ? "lg:grid-cols-2" : ""}`}>
        <section className="">
          <div className="border-b border-bungie-border/55 px-3 py-2">
            <p className="section-label">{match.teamLabel}</p>
          </div>
          <div className="divide-y divide-bungie-border/35">
            {match.team.map((player) => <RosterRow key={player.membershipId} player={player} />)}
          </div>
        </section>

        {match.opponents.length > 0 && (
          <section className="">
            <div className="border-b border-bungie-border/55 px-3 py-2">
              <p className="section-label">{match.opponentLabel ?? "Opponents"}</p>
            </div>
            <div className="divide-y divide-bungie-border/35">
              {match.opponents.map((player) => <RosterRow key={player.membershipId} player={player} />)}
            </div>
          </section>
        )}
        </div>
      </div>
    </article>
  );
}

export default function MatchHistoryPanel({
  matches,
  syncStatus,
  needsReauth = false,
}: {
  matches: SeasonMatch[];
  syncStatus: SeasonStatsSyncStatus;
  needsReauth?: boolean;
}) {
  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="panel flex min-h-[240px] flex-1 flex-col p-4">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div>
            <p className="section-label">Your match reports</p>
            {(syncStatus === "queued" || syncStatus === "syncing") && (
              <p className="mt-1 flex items-center gap-1.5 text-xs   text-bungie-blue/75">
                <RefreshCw size={9} className="animate-spin" /> Importing Crucible history
              </p>
            )}
          </div>
          <p className="text-sm   text-gray-500">
            {matches.length} recent
          </p>
        </div>

        {needsReauth && (
          <div className="mb-3 border border-bungie-blue/40 bg-bungie-blue/10 px-3 py-2 text-xs text-gray-300">
            Your Bungie sign-in has expired, so your Crucible history stopped updating.{" "}
            {/* OAuth re-auth entry point - must be a full navigation to the API route, not a client-side <Link>, same as SignOutButton. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/api/auth/bungie/login?reauth=true"
              className="font-semibold text-bungie-blue transition hover:text-bungie-blue/80"
            >
              Sign in again
            </a>{" "}
            to resume syncing.
          </div>
        )}

        {matches.length === 0 ? (
          <div className="flex flex-1 items-center justify-center border border-dashed border-bungie-border/70 bg-bungie-dark/25 px-5 text-center">
            <p className="max-w-[18rem] text-sm leading-relaxed text-gray-500">
              {syncStatus === "queued" || syncStatus === "syncing"
                ? "Importing your Crucible history. Recent games land first; older seasons fill in over time."
                : "Match reports will appear here as your Crucible history is imported. Recent games land first; older seasons fill in over time."}
            </p>
          </div>
        ) : (
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            {matches.map((match) => (
              <MatchCard key={match.instanceId ?? match.runId} match={match} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
