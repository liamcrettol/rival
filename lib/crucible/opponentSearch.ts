import { adminSupabase } from "@/lib/supabase/admin";
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
const bungieSearchCache = new Map<string, { expiresAt: number; results: OpponentSearchResult[] }>();

function parseNameQuery(query: string): { prefix: string; code: number | null } {
  const exact = query.trim().match(/^(.*?)#(\d{1,4})$/);
  return exact
    ? { prefix: exact[1].trim(), code: Number(exact[2]) }
    : { prefix: query.trim(), code: null };
}

function formatBungieName(name: string, code: number | undefined): string {
  return code == null ? name : `${name}#${String(code).padStart(4, "0")}`;
}

export function flattenBungieSearchResults(
  details: BungieSearchDetail[],
  query: string,
  limit = 12,
): OpponentSearchResult[] {
  const { code } = parseNameQuery(query);
  const results = new Map<string, OpponentSearchResult>();

  for (const detail of details) {
    if (!detail.bungieGlobalDisplayName) continue;
    if (code !== null && detail.bungieGlobalDisplayNameCode !== code) continue;
    const memberships = detail.destinyMemberships ?? [];
    const active = memberships.some((membership) => (membership.applicableMembershipTypes?.length ?? 0) > 0)
      ? memberships.filter((membership) => (membership.applicableMembershipTypes?.length ?? 0) > 0)
      : memberships;
    for (const membership of active) {
      if (!membership.membershipId || !/^\d{1,30}$/.test(membership.membershipId)) continue;
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
  // PostgREST parameterizes this value. Escaping wildcard characters keeps a
  // literal user-entered % or _ from accidentally widening the result set.
  const pattern = `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
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
    if (unique.size >= 8) break;
  }
  return [...unique.values()];
}

async function searchBungiePlayers(query: string): Promise<OpponentSearchResult[]> {
  const { prefix } = parseNameQuery(query);
  if (prefix.length < 2) return [];
  const key = query.toLocaleLowerCase();
  const cached = bungieSearchCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.results;

  const response = await fetch("https://www.bungie.net/Platform/User/Search/GlobalName/0/", {
    method: "POST",
    headers: {
      "X-API-Key": process.env.BUNGIE_API_KEY!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ displayNamePrefix: prefix }),
    cache: "no-store",
  });
  const body = await response.json().catch(() => null) as {
    ErrorCode?: number;
    ErrorStatus?: string;
    Message?: string;
    Response?: { searchResults?: BungieSearchDetail[] };
  } | null;
  if (!response.ok || (body?.ErrorCode && body.ErrorCode !== 1)) {
    throw new Error(`Bungie player search failed (${response.status}): ${body?.Message ?? body?.ErrorStatus ?? "unknown error"}`);
  }

  const results = flattenBungieSearchResults(body?.Response?.searchResults ?? [], query);
  if (bungieSearchCache.size >= SEARCH_CACHE_MAX) bungieSearchCache.delete(bungieSearchCache.keys().next().value!);
  bungieSearchCache.set(key, { expiresAt: Date.now() + SEARCH_CACHE_TTL_MS, results });
  return results;
}

export async function searchOpponents(input: {
  viewerUserId: string;
  query: string;
  db?: Db;
}): Promise<OpponentSearchResult[]> {
  const db = input.db ?? adminSupabase;
  const query = input.query.trim();
  const [local, bungie] = await Promise.all([
    searchLocalOpponents(input.viewerUserId, query, db),
    searchBungiePlayers(query).catch(() => []),
  ]);

  const merged = new Map<string, OpponentSearchResult>();
  for (const result of local) merged.set(result.membershipId, result);
  for (const result of bungie) {
    const existing = merged.get(result.membershipId);
    merged.set(result.membershipId, existing
      ? { ...result, source: "history", hasHistory: true }
      : result);
  }

  const results = [...merged.values()].slice(0, 16);
  const identities = await loadCanonicalPlayerIdentities(db, results.map((result) => result.membershipId));
  const summaries = await getHeadToHeadSummaries({
    viewerUserId: input.viewerUserId,
    opponentMembershipIds: results.map((result) => result.membershipId),
    db,
  });
  return results
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
    .sort((a, b) => Number(b.hasHistory) - Number(a.hasHistory) || a.displayName.localeCompare(b.displayName));
}
