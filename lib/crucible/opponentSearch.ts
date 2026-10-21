import { adminSupabase, createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getHeadToHeadSummaries } from "./headToHead";
import { isPlaceholderPlayerName, loadCanonicalPlayerIdentities } from "./playerIdentity";
import type { OpponentSearchResult } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

interface BungieMembership {
  membershipId?: string;
  membershipType?: number;
  displayName?: string;
  crossSaveOverride?: number;
  applicableMembershipTypes?: number[];
}

interface BungieUserInfoCard extends BungieMembership {
  bungieGlobalDisplayName?: string;
  bungieGlobalDisplayNameCode?: number;
}

interface BungieSearchDetail {
  bungieGlobalDisplayName?: string;
  bungieGlobalDisplayNameCode?: number;
  destinyMemberships?: BungieMembership[];
}

interface LocalEncounter {
  opponent_membership_id: string;
  opponent_membership_type: number | null;
  opponent_display_name: string;
  played_at: string;
}

const SEARCH_CACHE_TTL_MS = 5 * 60_000;
const SEARCH_CACHE_MAX = 100;
const RESULT_LIMIT = 16;
// A partial #code filters Bungie's name-prefix results, so read a few more
// pages to give the code a fair chance of matching.
const PARTIAL_CODE_PAGES = 3;
const bungieSearchCache = new Map<string, { expiresAt: number; results: OpponentSearchResult[] }>();

export interface ParsedNameQuery {
  // The Bungie Name part, with spaces around the "#" removed.
  prefix: string;
  // Digits typed after "#": null when there is no "#", "" for a bare "#".
  codePrefix: string | null;
}

// "Datto # 12" -> { prefix: "Datto", codePrefix: "12" }. Anything after "#"
// that is not 1 to 4 digits is treated as part of the name.
export function parseNameQuery(query: string): ParsedNameQuery {
  const trimmed = query.trim();
  const tagged = trimmed.match(/^(.*?)\s*#\s*(\d{0,4})$/);
  return tagged && tagged[1].trim()
    ? { prefix: tagged[1].trim(), codePrefix: tagged[2] }
    : { prefix: trimmed, codePrefix: null };
}

// "#12" matches #1234 and also #0012 typed without the leading zeros.
export function codeMatches(code: number | undefined, codePrefix: string | null): boolean {
  if (!codePrefix) return true;
  if (code == null) return false;
  return String(code).padStart(4, "0").startsWith(codePrefix) || String(code).startsWith(codePrefix);
}

function formatBungieName(name: string, code: number | undefined): string {
  return code == null ? name : `${name}#${String(code).padStart(4, "0")}`;
}

// Lower is better: exact name, name prefix, word prefix, anywhere, other.
export function matchRank(displayName: string, query: string): number {
  const { prefix, codePrefix } = parseNameQuery(query);
  const needle = prefix.toLocaleLowerCase();
  const hash = displayName.lastIndexOf("#");
  const base = (hash > 0 ? displayName.slice(0, hash) : displayName).toLocaleLowerCase();
  const code = hash > 0 && /^\d{1,4}$/.test(displayName.slice(hash + 1)) ? Number(displayName.slice(hash + 1)) : undefined;
  if (codePrefix && !codeMatches(code, codePrefix)) return 5;
  if (base === needle) return codePrefix && codePrefix.length === 4 ? 0 : 1;
  if (base.startsWith(needle)) return 2;
  if (base.split(/[\s._-]+/).some((word) => word.startsWith(needle))) return 3;
  if (base.includes(needle)) return 4;
  return 5;
}

export function flattenBungieSearchResults(
  details: BungieSearchDetail[],
  query: string,
  limit = 12,
): OpponentSearchResult[] {
  const { codePrefix } = parseNameQuery(query);
  const results = new Map<string, OpponentSearchResult>();

  for (const detail of details) {
    if (!detail.bungieGlobalDisplayName) continue;
    if (!codeMatches(detail.bungieGlobalDisplayNameCode, codePrefix)) continue;
    const memberships = detail.destinyMemberships ?? [];
    const active = memberships.some((membership) => (membership.applicableMembershipTypes?.length ?? 0) > 0)
      ? memberships.filter((membership) => (membership.applicableMembershipTypes?.length ?? 0) > 0)
      : memberships;
    for (const membership of active) {
      if (!membership.membershipId || !/^\d{1,30}$/.test(membership.membershipId)) continue;
      if (results.has(membership.membershipId)) continue;
      results.set(membership.membershipId, {
        membershipId: membership.membershipId,
        membershipType: membership.membershipType ?? null,
        displayName: formatBungieName(detail.bungieGlobalDisplayName, detail.bungieGlobalDisplayNameCode),
        platformDisplayName: membership.displayName ?? null,
        emblemPath: null,
        source: "bungie",
        hasHistory: false,
        summary: null,
      });
      if (results.size >= limit) return [...results.values()];
    }
  }
  return [...results.values()];
}

async function searchLocalOpponents(
  viewerUserId: string,
  query: string,
  db: Db,
): Promise<OpponentSearchResult[]> {
  // Match the name part anywhere (trigram index, migration 027), then apply a
  // partial #code here so "Name#12" still finds a stored "Name#0012".
  const { prefix, codePrefix } = parseNameQuery(query);
  // PostgREST parameterizes this value. Escaping wildcard characters keeps a
  // literal user-entered % or _ from accidentally widening the result set.
  const pattern = `%${prefix.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
  const { data, error } = await db
    .from("crucible_encounters")
    .select("opponent_membership_id,opponent_membership_type,opponent_display_name,played_at")
    .eq("viewer_user_id", viewerUserId)
    .ilike("opponent_display_name", pattern)
    .order("played_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(`Local opponent search failed: ${error.message}`);

  const unique = new Map<string, OpponentSearchResult>();
  for (const row of (data ?? []) as LocalEncounter[]) {
    if (unique.has(row.opponent_membership_id)) continue;
    if (codePrefix && matchRank(row.opponent_display_name, query) > 4) continue;
    unique.set(row.opponent_membership_id, {
      membershipId: row.opponent_membership_id,
      membershipType: row.opponent_membership_type,
      displayName: row.opponent_display_name,
      platformDisplayName: null,
      emblemPath: null,
      source: "history",
      hasHistory: true,
      summary: null,
    });
    if (unique.size >= 12) break;
  }
  return [...unique.values()];
}

interface BungieResponse<T> {
  ErrorCode?: number;
  ErrorStatus?: string;
  Message?: string;
  Response?: T;
}

async function bungiePost<T>(path: string, payload: unknown): Promise<T | undefined> {
  const response = await fetch(`https://www.bungie.net/Platform${path}`, {
    method: "POST",
    headers: {
      "X-API-Key": process.env.BUNGIE_API_KEY!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  const body = await response.json().catch(() => null) as BungieResponse<T> | null;
  if (!response.ok || (body?.ErrorCode && body.ErrorCode !== 1)) {
    throw new Error(`Bungie player search failed (${response.status}): ${body?.Message ?? body?.ErrorStatus ?? "unknown error"}`);
  }
  return body?.Response;
}

// The exact Name#1234 lookup. The prefix search pages through everyone whose
// name starts the same way, so a common name can push the right Guardian off
// the pages we read; this finds them directly.
async function exactBungieLookup(prefix: string, code: number): Promise<BungieSearchDetail[]> {
  const cards = await bungiePost<BungieUserInfoCard[]>(
    "/Destiny2/SearchDestinyPlayerByBungieName/-1/",
    { displayName: prefix, displayNameCode: code },
  ) ?? [];
  if (cards.length === 0) return [];
  return [{
    bungieGlobalDisplayName: cards[0].bungieGlobalDisplayName ?? prefix,
    bungieGlobalDisplayNameCode: cards[0].bungieGlobalDisplayNameCode ?? code,
    destinyMemberships: cards,
  }];
}

async function searchBungiePlayers(query: string): Promise<OpponentSearchResult[]> {
  const { prefix, codePrefix } = parseNameQuery(query);
  if (prefix.length < 2) return [];
  const key = `${prefix}#${codePrefix ?? ""}`.toLocaleLowerCase();
  const cached = bungieSearchCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.results;

  const pages = codePrefix && codePrefix.length < 4 ? PARTIAL_CODE_PAGES : 1;
  const pageRequests = Array.from({ length: pages }, (_, page) =>
    bungiePost<{ searchResults?: BungieSearchDetail[] }>(`/User/Search/GlobalName/${page}/`, { displayNamePrefix: prefix })
      .then((found) => found?.searchResults ?? []),
  );
  const exact = codePrefix?.length === 4
    ? exactBungieLookup(prefix, Number(codePrefix)).catch((error) => {
        console.warn("[crucible/opponents/search] exact Bungie lookup failed:", (error as Error).message);
        return [];
      })
    : Promise.resolve([]);
  // Page 0 must succeed; later pages are a bonus (an empty or failed page
  // just means there were fewer names).
  const [first, ...rest] = await Promise.all([
    pageRequests[0],
    ...pageRequests.slice(1).map((request) => request.catch(() => [])),
  ]);
  const details = [...(await exact), ...first, ...rest.flat()];

  const results = flattenBungieSearchResults(details, query, RESULT_LIMIT);
  if (bungieSearchCache.size >= SEARCH_CACHE_MAX) bungieSearchCache.delete(bungieSearchCache.keys().next().value!);
  bungieSearchCache.set(key, { expiresAt: Date.now() + SEARCH_CACHE_TTL_MS, results });
  return results;
}

function compareResults(query: string) {
  return (a: OpponentSearchResult, b: OpponentSearchResult) =>
    matchRank(a.displayName, query) - matchRank(b.displayName, query)
    || Number(b.hasHistory) - Number(a.hasHistory)
    || (b.summary?.encounters ?? 0) - (a.summary?.encounters ?? 0)
    || a.displayName.localeCompare(b.displayName);
}

export interface OpponentSearchResponse {
  results: OpponentSearchResult[];
  // True when Bungie's player search failed, so only players from the
  // viewer's own history could be suggested.
  bungieUnavailable: boolean;
}

export async function searchOpponents(input: {
  viewerUserId: string;
  query: string;
  db?: Db;
}): Promise<OpponentSearchResponse> {
  const db = input.db ?? adminSupabase;
  const query = input.query.trim();
  const [localResult, bungieResult] = await Promise.allSettled([
    searchLocalOpponents(input.viewerUserId, query, db),
    searchBungiePlayers(query),
  ]);
  if (localResult.status === "rejected" && bungieResult.status === "rejected") {
    throw localResult.reason;
  }
  if (localResult.status === "rejected") {
    console.error("[crucible/opponents/search]", (localResult.reason as Error).message);
  }
  if (bungieResult.status === "rejected") {
    console.warn("[crucible/opponents/search]", (bungieResult.reason as Error).message);
  }
  const local = localResult.status === "fulfilled" ? localResult.value : [];
  const bungie = bungieResult.status === "fulfilled" ? bungieResult.value : [];

  const merged = new Map<string, OpponentSearchResult>();
  for (const result of local) merged.set(result.membershipId, result);
  for (const result of bungie) {
    const existing = merged.get(result.membershipId);
    merged.set(result.membershipId, existing
      ? { ...result, source: "history", hasHistory: true }
      : result);
  }

  // Rank before trimming so a close match is never cut for a loose one.
  const results = [...merged.values()].sort(compareResults(query)).slice(0, RESULT_LIMIT);
  const ids = results.map((result) => result.membershipId);
  // See matchHistory.ts: this RPC can exceed the app-wide 1.2s budget as
  // crucible_match_players grows, so give it the same room as the rivalry-leaders route.
  const [identities, summaries] = await Promise.all([
    loadCanonicalPlayerIdentities(input.db ?? createAdminSupabaseClient(5_000), ids),
    getHeadToHeadSummaries({ viewerUserId: input.viewerUserId, opponentMembershipIds: ids, db }),
  ]);
  return {
    bungieUnavailable: bungieResult.status === "rejected",
    results: results
      .map((result) => {
        const identity = identities.get(result.membershipId);
        return {
          ...result,
          membershipType: !result.membershipType && identity?.membership_type
            ? identity.membership_type
            : result.membershipType,
          displayName: isPlaceholderPlayerName(result.displayName) && identity?.display_name
            ? identity.display_name
            : result.displayName,
          emblemPath: identity?.emblem_path ?? null,
          hasHistory: Boolean(summaries[result.membershipId]),
          summary: summaries[result.membershipId] ?? null,
        };
      })
      .sort(compareResults(query)),
  };
}
