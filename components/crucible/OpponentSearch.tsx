"use client";

import { useEffect, useRef, useState } from "react";
import { Globe2, LoaderCircle, Search, ShieldAlert, ShieldCheck, Trophy, X } from "lucide-react";
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
  const Icon = kind === "wins" ? Trophy : ShieldAlert;
  return (
    <div className="border border-bungie-border bg-bungie-dark/35">
      <div className="flex items-center gap-2 border-b border-bungie-border px-3 py-2.5">
        <Icon size={14} className={kind === "wins" ? "text-green-300" : "text-red-300"} />
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-gray-200">{title}</p>
          <p className="mt-0.5 text-[10px] text-gray-500">{subtitle}</p>
        </div>
      </div>
      <div className="divide-y divide-bungie-border/60">
        {leaders.map((leader) => (
          <button
            key={leader.membershipId}
            type="button"
            onClick={() => onChoose(leader)}
            className="grid w-full grid-cols-[1.25rem_2.25rem_1fr_auto] items-center gap-2.5 px-3 py-2.5 text-left transition hover:bg-bungie-dark/80"
          >
            <span className="font-mono text-[11px] font-bold text-gray-600">#{leader.rank}</span>
            {bungieImg(leader.emblemPath) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={bungieImg(leader.emblemPath)} alt="" className="h-9 w-9 border border-white/10 object-cover" />
            ) : (
              <span className="flex h-9 w-9 items-center justify-center border border-white/10 bg-bungie-surface text-xs font-bold text-gray-600">
                {leader.displayName.slice(0, 1).toUpperCase()}
              </span>
            )}
            <span className="min-w-0">
              <span className="block truncate text-xs font-semibold text-white">{leader.displayName}</span>
              <span className="mt-0.5 block text-[10px] text-gray-500">{leader.encounters} meetings · Last {formatDate(leader.lastPlayedAt)}</span>
            </span>
            <span className="shrink-0 font-mono text-[11px] font-bold">
              {kind === "wins" ? (
                <span className="text-green-300">{leader.wins}W</span>
              ) : (
                <span className="text-red-300">{leader.losses}L</span>
              )}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function OpponentSearch({ children }: { children?: React.ReactNode } = {}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<OpponentSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
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
        setActiveIndex(-1);
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          setSearchError(error instanceof Error ? error.message : "Search failed");
          setResults([]);
        }
      } finally {
        if (searchRequest.current === controller) setSearching(false);
      }
    }, 350);
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
    } else if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      choose(results[activeIndex]);
    } else if (event.key === "Escape") {
      setResults([]);
    }
  }

  return (
    <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
      <div className="w-full min-w-0 max-w-5xl flex-1 space-y-6">
        <section className="panel" aria-labelledby="opponent-search-heading">
      <div className="border-b border-bungie-border px-6 py-8 sm:px-8">
       <div className="max-w-3xl">
        <p className="section-label">Guardian search</p>
        <h2 id="opponent-search-heading" className="mt-1 text-2xl font-bold tracking-tight text-white">Find your history against anyone</h2>
        <p className="mt-2 text-sm leading-relaxed text-gray-400">
          Search a Bungie Name. Players from your history appear first; Bungie results show whether you have ever met.
        </p>

        <div className="relative mt-6">
          <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" size={19} />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              if (selected && event.target.value !== selected.displayName) {
                setSelected(null);
                setDetail(null);
              }
            }}
            onKeyDown={onKeyDown}
            placeholder="Bungie Name#1234"
            aria-label="Search Bungie players"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={results.length > 0}
            aria-controls="opponent-search-results"
            className="h-14 w-full border border-bungie-border bg-bungie-dark pl-12 pr-20 text-base text-white placeholder:text-gray-600 focus:border-bungie-blue focus:outline-none"
          />
          <div className="absolute right-4 top-1/2 flex -translate-y-1/2 items-center gap-2">
            {searching && <LoaderCircle className="animate-spin text-bungie-blue" size={16} />}
            {query && (
              <button type="button" onClick={clear} aria-label="Clear player search" className="text-gray-500 hover:text-white">
                <X size={16} />
              </button>
            )}
          </div>

          {results.length > 0 && (
            <div id="opponent-search-results" role="listbox" className="absolute z-50 mt-1 max-h-80 w-full overflow-y-auto border border-bungie-border bg-bungie-surface shadow-2xl">
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
                    <img src={bungieImg(result.emblemPath)} alt="" className="h-10 w-10 border border-white/10 object-cover" />
                  ) : (
                    <span className="flex h-10 w-10 items-center justify-center border border-white/10 bg-bungie-dark text-sm font-bold text-gray-600">
                      {result.displayName.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-white">{result.displayName}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-gray-500">
                      {result.platformDisplayName && result.platformDisplayName !== result.displayName
                        ? `${result.platformDisplayName} · `
                        : ""}
                      {result.membershipType ? PLATFORM_NAMES[result.membershipType] ?? "Destiny" : "Destiny"}
                    </span>
                  </span>
                  {result.summary ? (
                    <span className="text-right">
                      <span className="block font-mono text-xs font-bold">
                        <span className="text-green-300">{result.summary.wins}W</span>
                        <span className="mx-1 text-gray-600">/</span>
                        <span className="text-red-300">{result.summary.losses}L</span>
                      </span>
                      <span className="mt-0.5 block text-[10px] uppercase tracking-wider text-bungie-blue">In your history</span>
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-gray-500">
                      <Globe2 size={12} /> Bungie
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {query.trim().length >= 2 && !searching && results.length === 0 && !selected && !searchError && (
          <p className="mt-2 text-xs text-gray-500">No Bungie players found.</p>
        )}
        {searchError && <p className="mt-2 text-xs text-red-300">{searchError}</p>}
       </div>
      </div>

      {selected && (
        <div className="px-4 py-4 sm:px-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              {bungieImg(selected.emblemPath) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={bungieImg(selected.emblemPath)} alt="" className="h-14 w-14 border border-white/10 object-cover" />
              ) : (
                <span className="flex h-14 w-14 items-center justify-center border border-white/10 bg-bungie-dark text-lg font-bold text-gray-600">
                  {selected.displayName.slice(0, 1).toUpperCase()}
                </span>
              )}
              <div>
                <p className="section-label">Selected guardian</p>
                <h3 className="mt-1 text-base font-bold text-white">{selected.displayName}</h3>
                <p className="mt-1 text-[11px] text-gray-500">
                  {selected.membershipType ? PLATFORM_NAMES[selected.membershipType] ?? "Destiny" : "Destiny"} · {selected.membershipId}
                </p>
              </div>
            </div>
            {detail?.summary && (
              <div className="text-right">
                <p className="font-mono text-lg font-bold">
                  <span className="text-green-300">{detail.summary.wins} W</span>
                  <span className="mx-2 text-gray-600">/</span>
                  <span className="text-red-300">{detail.summary.losses} L</span>
                </p>
                <p className="text-[10px] uppercase tracking-wider text-gray-500">{detail.summary.encounters} meetings</p>
              </div>
            )}
          </div>

          {detailLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-xs text-gray-400">
              <LoaderCircle className="animate-spin text-bungie-blue" size={17} /> Loading shared history…
            </div>
          ) : detail && !detail.summary ? (
            <div className="mt-4 border border-bungie-border bg-bungie-dark/50 px-4 py-8 text-center">
              <Globe2 className="mx-auto text-gray-600" size={24} />
              <p className="mt-3 text-sm font-semibold text-white">No shared matches found</p>
              <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-gray-500">
                Bungie found this Guardian, but their membership ID does not appear in your recorded Rival history.
              </p>
            </div>
          ) : detail?.summary ? (
            <>
              <div className="mt-4 grid grid-cols-3 gap-px border border-bungie-border bg-bungie-border sm:grid-cols-6">
                {FILTERS.map((filter) => {
                  const record = filter.key === "all"
                    ? detail.summary!
                    : detail.summary!.byMode[filter.key] ?? { encounters: 0, wins: 0, losses: 0, unknown: 0 };
                  return (
                    <button
                      key={filter.key}
                      type="button"
                      onClick={() => changeMode(filter.key)}
                      className={`px-2 py-2.5 text-center ${mode === filter.key ? "bg-bungie-dark text-white" : "bg-bungie-surface text-gray-400 hover:bg-bungie-dark/70"}`}
                    >
                      <span className="block truncate text-[10px] font-bold uppercase tracking-wider">{filter.label}</span>
                      <span className={`mt-1 block font-mono text-xs ${mode === filter.key ? "text-bungie-blue" : "text-gray-500"}`}>{record.encounters}</span>
                    </button>
                  );
                })}
              </div>

              <div className="mt-4 border border-bungie-border">
                <div className="flex items-center justify-between border-b border-bungie-border px-3 py-2.5">
                  <p className="section-label">Match history</p>
                  <p className="text-[10px] uppercase tracking-wider text-gray-500">Last met {formatDate(detail.summary.lastPlayedAt)}</p>
                </div>
                {detail.reports.length > 0 ? (
                  <div className="space-y-3 bg-bungie-dark/20 p-3">
                    {detail.reports.map((report) => (
                      <MatchCard key={report.instanceId ?? report.runId} match={report} />
                    ))}
                  </div>
                ) : (
                  <p className="px-3 py-8 text-center text-xs text-gray-500">No meetings in this playlist.</p>
                )}
                {detail.nextCursor && (
                  <button
                    type="button"
                    disabled={loadingMore}
                    onClick={() => void loadDetail(selected, mode, detail.nextCursor!)}
                    className="flex w-full items-center justify-center gap-2 border-t border-bungie-border px-3 py-3 text-[10px] font-bold uppercase tracking-widest text-gray-400 hover:bg-bungie-dark/60 hover:text-white disabled:opacity-50"
                  >
                    {loadingMore && <LoaderCircle className="animate-spin" size={13} />}
                    Load more
                  </button>
                )}
              </div>
              <p className="mt-3 flex items-center gap-1.5 text-[10px] text-gray-500">
                <ShieldCheck size={12} /> Cross-referenced by Destiny membership ID, not display name.
              </p>
            </>
          ) : null}
        </div>
      )}
        </section>

        {children}
      </div>

      <aside className="w-full space-y-6 xl:w-[320px] xl:shrink-0">
        {leadersLoading ? (
          <div className="flex items-center justify-center gap-2 border border-bungie-border bg-bungie-dark/35 py-8 text-xs text-gray-500">
            <LoaderCircle className="animate-spin" size={14} /> Ranking your rivalries…
          </div>
        ) : leaders && (leaders.mostDefeated.length > 0 || leaders.toughestRivals.length > 0) ? (
          <>
            <RivalryList
              title="Most Defeated"
              subtitle="Guardians you have beaten most"
              leaders={leaders.mostDefeated}
              kind="wins"
              onChoose={(leader) => choose(leaderAsSearchResult(leader))}
            />
            <RivalryList
              title="Toughest Rivals"
              subtitle="Guardians who have beaten you most"
              leaders={leaders.toughestRivals}
              kind="losses"
              onChoose={(leader) => choose(leaderAsSearchResult(leader))}
            />
          </>
        ) : null}
      </aside>
    </div>
  );
}
