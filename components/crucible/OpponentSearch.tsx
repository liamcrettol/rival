"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Globe2, LoaderCircle, Search, ShieldCheck, X } from "lucide-react";
import { bungieImg } from "@/lib/destiny/constants";
import { MatchCard } from "@/components/MatchHistoryPanel";
import type { SeasonMatch } from "@/types/platform";
import type {
  CrucibleModeBucket,
  HeadToHeadSummary,
  OpponentSearchResult,
  RivalryLeader,
} from "@/lib/crucible/types";

const FILTERS: Array<{ key: "all" | CrucibleModeBucket; label: string }> = [
  { key: "all", label: "All" },
  { key: "trials", label: "Trials" },
  { key: "competitive", label: "Competitive" },
  { key: "control", label: "Control" },
  { key: "iron_banner", label: "Iron Banner" },
  { key: "other", label: "Other" },
];

const PLATFORM_NAMES: Record<number, string> = {
  1: "Xbox",
  2: "PlayStation",
  3: "Steam",
  4: "Blizzard",
  5: "Stadia",
  6: "Epic",
};

interface DetailResponse {
  summary: HeadToHeadSummary | null;
  matches: Array<{ instanceId: string }>;
  reports: SeasonMatch[];
  nextCursor: string | null;
}

interface RivalryLeadersResponse {
  mostDefeated: RivalryLeader[];
  toughestRivals: RivalryLeader[];
}

function formatDate(value: string | null) {
  if (!value) return "Never";
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// "Name#1234" -> ["Name", "#1234"] so the tag can sit small beside a big name.
function splitBungieName(name: string): [string, string] {
  const i = name.lastIndexOf("#");
  return i > 0 && /^\d{3,4}$/.test(name.slice(i + 1)) ? [name.slice(0, i), name.slice(i)] : [name, ""];
}

// Underline the typed part of a suggestion so it is clear why it matched.
function HighlightedName({ name, query }: { name: string; query: string }) {
  const needle = query.trim().replace(/\s*#\s*/, "#").replace(/#$/, "").toLocaleLowerCase();
  const at = needle ? name.toLocaleLowerCase().indexOf(needle) : -1;
  if (at < 0) return <>{name}</>;
  return (
    <>
      {name.slice(0, at)}
      <span className="text-white underline decoration-white/40 underline-offset-2">{name.slice(at, at + needle.length)}</span>
      {name.slice(at + needle.length)}
    </>
  );
}

function HeroName({ name }: { name: string }) {
  const [base, tag] = splitBungieName(name);
  return (
    <h1 className="font-wide break-words text-[48px]  leading-[0.9] sm:text-[84px]">
      {base}
      {tag && <span className="ml-3 align-baseline tabular-nums text-lg font-normal normal-case tracking-normal text-gray-500 sm:text-2xl">{tag}</span>}
    </h1>
  );
}

function leaderAsSearchResult(leader: RivalryLeader): OpponentSearchResult {
  return {
    membershipId: leader.membershipId,
    membershipType: leader.membershipType,
    displayName: leader.displayName,
    platformDisplayName: null,
    emblemPath: leader.emblemPath,
    source: "history",
    hasHistory: true,
    summary: null,
  };
}

function RivalryList({
  title,
  subtitle,
  leaders,
  kind,
  onChoose,
}: {
  title: string;
  subtitle: string;
  leaders: RivalryLeader[];
  kind: "wins" | "losses";
  onChoose: (leader: RivalryLeader) => void;
}) {
  return (
    <div className="min-w-0">
      <h2 className="section-label">{title}</h2>
      <p className="mt-1 text-sm text-gray-500">{subtitle}</p>
      <ol className="mt-4 border-t border-bungie-border">
        {leaders.map((leader) => (
          <li key={leader.membershipId}>
            <button
              type="button"
              onClick={() => onChoose(leader)}
              className="grid min-h-11 w-full grid-cols-[1.5rem_2.5rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-bungie-border py-3 text-left transition-colors hover:bg-white/[0.03]"
            >
              <span className="tabular-nums text-xs text-gray-500">{leader.rank}</span>
              {bungieImg(leader.emblemPath) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={bungieImg(leader.emblemPath)} alt="" className="h-10 w-10 object-cover" />
              ) : (
                <span className="flex h-10 w-10 items-center justify-center bg-bungie-surface text-sm font-bold text-gray-500">
                  {leader.displayName.slice(0, 1).toUpperCase()}
                </span>
              )}
              <span className="min-w-0">
                <span className="block truncate font-semibold text-white">{leader.displayName}</span>
                <span className="mt-0.5 block text-xs text-gray-500">{leader.encounters} meetings | last {formatDate(leader.lastPlayedAt)}</span>
              </span>
              <span className="tabular-nums text-sm tabular-nums">
                <span className={kind === "wins" ? "text-green-400" : "text-gray-400"}>{leader.wins}</span>
                <span className="text-gray-500"> - </span>
                <span className={kind === "losses" ? "text-red-400" : "text-gray-400"}>{leader.losses}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

export default function OpponentSearch({ children }: { children?: React.ReactNode } = {}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<OpponentSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [bungieUnavailable, setBungieUnavailable] = useState(false);
  const [selected, setSelected] = useState<OpponentSearchResult | null>(null);
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [mode, setMode] = useState<"all" | CrucibleModeBucket>("all");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [leaders, setLeaders] = useState<RivalryLeadersResponse | null>(null);
  const [leadersLoading, setLeadersLoading] = useState(true);
  const searchRequest = useRef<AbortController | null>(null);
  const detailRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    const value = query.trim();
    if (selected && value === selected.displayName) return;
    if (value.length < 2) {
      searchRequest.current?.abort();
      setResults([]);
      setSearching(false);
      setSearchError(null);
      return;
    }

    const timer = setTimeout(async () => {
      searchRequest.current?.abort();
      const controller = new AbortController();
      searchRequest.current = controller;
      setSearching(true);
      setSearchError(null);
      try {
        const response = await fetch(`/api/crucible/opponents/search?q=${encodeURIComponent(value)}`, {
          signal: controller.signal,
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Search failed");
        setResults(body.results ?? []);
        setBungieUnavailable(Boolean(body.bungieUnavailable));
        setActiveIndex(body.results?.length ? 0 : -1);
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          setSearchError(error instanceof Error ? error.message : "Search failed");
          setResults([]);
        }
      } finally {
        if (searchRequest.current === controller) setSearching(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query, selected]);

  useEffect(() => () => {
    searchRequest.current?.abort();
    detailRequest.current?.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/crucible/opponents/leaders", { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Unable to load rivalry leaders");
        setLeaders(body);
      })
      .catch((error) => {
        if ((error as Error).name !== "AbortError") console.error("[rivalry-leaders]", error);
      })
      .finally(() => setLeadersLoading(false));
    return () => controller.abort();
  }, []);

  async function loadDetail(
    player: OpponentSearchResult,
    selectedMode: "all" | CrucibleModeBucket,
    cursor?: string,
  ) {
    if (!player.hasHistory) {
      setDetail({ summary: null, matches: [], reports: [], nextCursor: null });
      return;
    }
    if (!cursor) {
      detailRequest.current?.abort();
      detailRequest.current = new AbortController();
      setDetailLoading(true);
    } else {
      setLoadingMore(true);
    }
    try {
      const params = new URLSearchParams({ mode: selectedMode });
      if (cursor) params.set("cursor", cursor);
      const response = await fetch(`/api/crucible/head-to-head/${player.membershipId}?${params}`, {
        signal: cursor ? undefined : detailRequest.current?.signal,
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to load history");
      setDetail((current) => cursor
        ? {
            ...body,
            matches: [...(current?.matches ?? []), ...(body.matches ?? [])],
            reports: [...(current?.reports ?? []), ...(body.reports ?? [])],
          }
        : body);
    } catch (error) {
      if ((error as Error).name !== "AbortError") setSearchError(error instanceof Error ? error.message : "Unable to load history");
    } finally {
      setDetailLoading(false);
      setLoadingMore(false);
    }
  }

  function choose(player: OpponentSearchResult) {
    setSelected(player);
    setQuery(player.displayName);
    setResults([]);
    setMode("all");
    setDetail(null);
    setSearchError(null);
    void loadDetail(player, "all");
  }

  function changeMode(nextMode: "all" | CrucibleModeBucket) {
    if (!selected) return;
    setMode(nextMode);
    setDetail(null);
    void loadDetail(selected, nextMode);
  }

  function clear() {
    detailRequest.current?.abort();
    setQuery("");
    setResults([]);
    setSelected(null);
    setDetail(null);
    setSearchError(null);
    setMode("all");
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (results.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(results[Math.max(activeIndex, 0)]);
    } else if (event.key === "Escape") {
      setResults([]);
    }
  }

  // The hero: whoever you picked, else the Guardian you have met most often.
  const rivalPool = leaders ? [...leaders.mostDefeated, ...leaders.toughestRivals] : [];
  const topRival = rivalPool.reduce<RivalryLeader | null>(
    (best, leader) => (!best || leader.encounters > best.encounters ? leader : best),
    null,
  );
  const hero = selected && detail?.summary
    ? {
        label: "Your record against",
        name: selected.displayName,
        wins: detail.summary.wins,
        losses: detail.summary.losses,
        encounters: detail.summary.encounters,
        lastPlayedAt: detail.summary.lastPlayedAt,
        byMode: detail.summary.byMode,
        leader: null as RivalryLeader | null,
      }
    : !selected && topRival
      ? {
          label: "Your most faced rival",
          name: topRival.displayName,
          wins: topRival.wins,
          losses: topRival.losses,
          encounters: topRival.encounters,
          lastPlayedAt: topRival.lastPlayedAt,
          byMode: null,
          leader: topRival,
        }
      : null;
  const decided = hero ? hero.wins + hero.losses : 0;
  const winPct = hero && decided > 0 ? Math.round((hero.wins / decided) * 100) : null;

  return (
    <div className="flex flex-col gap-12">
      {/* Search */}
      <div className="relative w-full max-w-xl">
        <label htmlFor="opponent-search" className="section-label">Find your record against anyone</label>
        <div className="relative mt-3">
          <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
          <input
            id="opponent-search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              if (selected && event.target.value !== selected.displayName) {
                setSelected(null);
                setDetail(null);
              }
            }}
            onKeyDown={onKeyDown}
            placeholder="Start typing a name, no #code needed"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={results.length > 0}
            aria-controls="opponent-search-results"
            className="h-12 w-full border border-white/15 bg-bungie-dark pl-11 pr-20 text-[15px] text-white placeholder:text-gray-500 "
          />
          <div className="absolute right-4 top-1/2 flex -translate-y-1/2 items-center gap-2">
            {searching && <LoaderCircle className="animate-spin text-gray-300" size={16} />}
            {query && (
              <button type="button" onClick={clear} aria-label="Clear player search" className="grid h-11 w-11 place-items-center text-gray-400 hover:text-white">
                <X size={16} />
              </button>
            )}
          </div>

          {results.length > 0 && (
            <div id="opponent-search-results" role="listbox" className="absolute z-50 mt-1 max-h-80 w-full overflow-y-auto border border-bungie-border bg-bungie-surface ">
              {results.map((result, index) => (
                <button
                  key={result.membershipId}
                  type="button"
                  role="option"
                  aria-selected={activeIndex === index}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => choose(result)}
                  className={`grid w-full grid-cols-[2.5rem_1fr_auto] items-center gap-3 border-b border-bungie-border/70 px-3 py-2.5 text-left last:border-0 ${activeIndex === index ? "bg-bungie-dark" : "hover:bg-bungie-dark/70"}`}
                >
                  {bungieImg(result.emblemPath) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={bungieImg(result.emblemPath)} alt="" className="h-10 w-10 object-cover" />
                  ) : (
                    <span className="flex h-10 w-10 items-center justify-center bg-bungie-dark text-sm font-bold text-gray-500">
                      {result.displayName.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-gray-200"><HighlightedName name={result.displayName} query={query} /></span>
                    <span className="mt-0.5 block truncate text-xs text-gray-500">
                      {result.platformDisplayName && result.platformDisplayName !== result.displayName
                        ? `${result.platformDisplayName} | `
                        : ""}
                      {result.membershipType ? PLATFORM_NAMES[result.membershipType] ?? "Destiny" : "Destiny"}
                    </span>
                  </span>
                  {result.summary ? (
                    <span className="text-right tabular-nums text-sm tabular-nums">
                      <span className="text-green-400">{result.summary.wins}</span>
                      <span className="text-gray-500"> - </span>
                      <span className="text-red-400">{result.summary.losses}</span>
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs text-gray-500">
                      <Globe2 size={12} /> Never met
                    </span>
                  )}
                </button>
              ))}
              {bungieUnavailable && (
                <p className="px-3 py-2 text-xs text-gray-500">Bungie&apos;s player search is not answering, so these are only players you have met.</p>
              )}
            </div>
          )}
        </div>
        {query.trim().length >= 2 && !searching && results.length === 0 && !selected && !searchError && (
          <p className="mt-2 text-sm text-gray-500">
            {bungieUnavailable
              ? "Bungie's player search is not answering right now. Try again in a moment."
              : "No players found with that name."}
          </p>
        )}
        {searchError && <p className="mt-2 text-sm text-red-300">{searchError}</p>}
      </div>

      {/* Hero */}
      {selected && detailLoading ? (
        <div className="flex items-center gap-2 py-10 text-sm text-gray-400">
          <LoaderCircle className="animate-spin" size={17} /> Loading your history with {selected.displayName}
        </div>
      ) : selected && detail && !detail.summary ? (
        <section className="flex flex-col gap-3 py-6">
          <p className="section-label">Your record against</p>
          <HeroName name={selected.displayName} />
          <p className="max-w-[52ch] text-[15px] text-gray-400">
            You have no recorded matches against this Guardian yet. Rival only sees matches Bungie still has in your history.
          </p>
        </section>
      ) : hero ? (
        <section aria-label={hero.label} className="flex flex-wrap items-end gap-x-12 gap-y-8">
          <div className="flex min-w-0 flex-[999_1_520px] flex-col gap-4">
            <p className="section-label">{hero.label}</p>
            <HeroName name={hero.name} />
            <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
              <span className="tabular-nums text-[52px] font-medium leading-none tabular-nums">
                <span className="text-green-400">{hero.wins}</span>
                <span className="text-gray-500"> - </span>
                <span className="text-red-400">{hero.losses}</span>
              </span>
              <span className="text-[15px] text-gray-400">
                {winPct !== null ? `You win ${winPct}% of ${hero.encounters} recorded meetings` : `${hero.encounters} recorded meetings`}
                {hero.lastPlayedAt ? `, last on ${formatDate(hero.lastPlayedAt)}` : ""}
              </span>
            </div>
            {decided > 0 && (
              <div className="flex h-1.5 max-w-[560px]" aria-hidden="true">
                <span className="bg-green-500" style={{ width: `${(hero.wins / decided) * 100}%` }} />
                <span className="flex-1 bg-red-500" />
              </div>
            )}
          </div>

          <div className="flex min-w-0 flex-[1_1_280px] flex-col">
            {hero.byMode ? (
              <>
                {FILTERS.map((filter) => {
                  const record = filter.key === "all"
                    ? detail!.summary!
                    : detail!.summary!.byMode[filter.key] ?? { encounters: 0, wins: 0, losses: 0, unknown: 0 };
                  if (filter.key !== "all" && record.encounters === 0) return null;
                  return (
                    <button
                      key={filter.key}
                      type="button"
                      aria-pressed={mode === filter.key}
                      onClick={() => changeMode(filter.key)}
                      className={`flex min-h-11 items-center justify-between border-t border-bungie-border px-1 text-left text-[15px] transition-colors ${mode === filter.key ? "text-white" : "text-gray-400 hover:text-white"}`}
                    >
                      <span>{filter.label}</span>
                      <span className="tabular-nums tabular-nums">{record.wins} - {record.losses}</span>
                    </button>
                  );
                })}
              </>
            ) : hero.leader ? (
              <button
                type="button"
                onClick={() => choose(leaderAsSearchResult(hero.leader!))}
                className="self-start border border-white/15 px-5 py-3 text-sm font-semibold transition-colors hover:border-white/30 hover:bg-white/5"
              >
                See every meeting
              </button>
            ) : null}
          </div>
        </section>
      ) : leadersLoading ? (
        <div className="flex items-center gap-2 py-10 text-sm text-gray-500">
          <LoaderCircle className="animate-spin" size={15} /> Ranking your rivalries
        </div>
      ) : null}

      {/* Meetings with the selected Guardian */}
      {selected && detail?.summary && (
        <section aria-labelledby="meetings-h" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="meetings-h" className="section-label">Every meeting{mode !== "all" ? `, ${FILTERS.find((f) => f.key === mode)?.label ?? ""}` : ""}</h2>
            <p className="flex items-center gap-1.5 text-xs text-gray-500"><ShieldCheck size={12} /> Matched by Destiny membership ID, not display name</p>
          </div>
          {detail.reports.length > 0 ? (
            <div className="flex flex-col gap-3">
              {detail.reports.map((report) => (
                <MatchCard key={report.instanceId ?? report.runId} match={report} />
              ))}
            </div>
          ) : (
            <p className="py-8 text-sm text-gray-500">No meetings in this playlist.</p>
          )}
          {detail.nextCursor && (
            <button
              type="button"
              disabled={loadingMore}
              onClick={() => void loadDetail(selected, mode, detail.nextCursor!)}
              className="flex min-h-11 items-center justify-center gap-2 border border-white/15 text-sm font-semibold text-gray-300 hover:border-white/30 hover:text-white disabled:opacity-50"
            >
              {loadingMore && <LoaderCircle className="animate-spin" size={14} />}
              Load more
            </button>
          )}
        </section>
      )}

      {/* Your recent matches */}
      <section aria-label="Your recent matches" className="min-w-0">
        {children}
      </section>

      {/* Rivalries */}
      {leaders && (leaders.mostDefeated.length > 0 || leaders.toughestRivals.length > 0) && (
        <section aria-label="Rivalries" className="grid gap-x-12 gap-y-10 md:grid-cols-2">
          <RivalryList
            title="Most defeated"
            subtitle="Guardians you have beaten most"
            leaders={leaders.mostDefeated}
            kind="wins"
            onChoose={(leader) => choose(leaderAsSearchResult(leader))}
          />
          <RivalryList
            title="Toughest rivals"
            subtitle="Guardians who have beaten you most"
            leaders={leaders.toughestRivals}
            kind="losses"
            onChoose={(leader) => choose(leaderAsSearchResult(leader))}
          />
        </section>
      )}
      <a href="/leaderboard" className="inline-flex items-center gap-2 self-start text-sm font-semibold text-gray-300 underline decoration-white/25 underline-offset-4 hover:decoration-white">
        Match Hall of Fame <ArrowUpRight size={14} />
      </a>
    </div>
  );
}
