import type { Databases, AppwriteException as AppwriteExceptionType } from "node-appwrite";

// Appwrite-backed cache of each opponent's lifetime Trials of Osiris K/D
// (see lib/bungie/trialsStats.ts for the Bungie fetch itself). This lives in
// an Appwrite Database, not Supabase - same reasoning as lib/pgcr/archive.ts:
// externally-sourced, slowly-changing data that this app only caches, kept
// out of the Postgres schema that owns the locally-recorded match history.
//
// The "node-appwrite" import is dynamic, deferred to first use, for the same
// reason as archive.ts: it pulls in undici at module-load time, which assumes
// a real Node runtime and would break any context that merely imports this
// module transitively without calling it. Only type-only imports are static.
//
// One-time setup required before this works (mirrors the PGCR bucket setup):
// create an Appwrite Database + a collection with attributes membership_type
// (integer), trials_kills/trials_deaths/trials_activities_entered/
// characters_checked (integer, default 0), last_error (string, optional),
// fetched_at (datetime) - then set APPWRITE_DATABASE_ID and
// APPWRITE_TRIALS_STATS_COLLECTION_ID. Documents are keyed by membership_id
// as the Appwrite document ID (numeric Destiny IDs are valid custom IDs), so
// no separate membership_id attribute is needed.

const DEFAULT_COLLECTION_ID = "trials-stats";

export interface TrialsStatsDoc {
  membershipId: string;
  membershipType: number;
  trialsKills: number;
  trialsDeaths: number;
  trialsActivitiesEntered: number;
  charactersChecked: number;
  lastError: string | null;
  fetchedAt: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

let databases: Databases | null = null;
let AppwriteExceptionRef: typeof AppwriteExceptionType | null = null;

async function getDatabases(): Promise<Databases> {
  if (!databases) {
    const { Client, Databases: DatabasesCtor, AppwriteException } = await import("node-appwrite");
    AppwriteExceptionRef = AppwriteException;
    const client = new Client()
      .setEndpoint(requireEnv("APPWRITE_ENDPOINT"))
      .setProject(requireEnv("APPWRITE_PROJECT_ID"))
      .setKey(requireEnv("APPWRITE_API_KEY"));
    databases = new DatabasesCtor(client);
  }
  return databases;
}

function getDatabaseId(): string {
  return requireEnv("APPWRITE_DATABASE_ID");
}

function getCollectionId(): string {
  return process.env.APPWRITE_TRIALS_STATS_COLLECTION_ID?.trim() || DEFAULT_COLLECTION_ID;
}

function isAppwriteException(err: unknown): err is InstanceType<typeof AppwriteExceptionType> {
  return AppwriteExceptionRef !== null && err instanceof AppwriteExceptionRef;
}

function isNotFound(err: unknown): boolean {
  return isAppwriteException(err) && err.code === 404;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fromDocument(doc: any): TrialsStatsDoc {
  return {
    membershipId: doc.$id,
    membershipType: doc.membership_type,
    trialsKills: doc.trials_kills ?? 0,
    trialsDeaths: doc.trials_deaths ?? 0,
    trialsActivitiesEntered: doc.trials_activities_entered ?? 0,
    charactersChecked: doc.characters_checked ?? 0,
    lastError: doc.last_error ?? null,
    fetchedAt: doc.fetched_at,
  };
}

const FRESH_MS = 14 * 24 * 60 * 60 * 1000;
const ERROR_RETRY_MS = 3 * 24 * 60 * 60 * 1000;

// Missing entirely -> always needs a fetch. A clean fetch is good for 14
// days; a failed one (private profile, deleted account) is retried sooner
// since it might resolve, but not every single cron run.
export function needsTrialsStatsFetch(doc: TrialsStatsDoc | undefined | null): boolean {
  if (!doc) return true;
  const age = Date.now() - new Date(doc.fetchedAt).getTime();
  return age > (doc.lastError ? ERROR_RETRY_MS : FRESH_MS);
}

export async function getTrialsStats(membershipId: string): Promise<TrialsStatsDoc | null> {
  try {
    const doc = await (await getDatabases()).getDocument({
      databaseId: getDatabaseId(),
      collectionId: getCollectionId(),
      documentId: membershipId,
    });
    return fromDocument(doc);
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

// Appwrite queries cap the number of values in a single Query.equal array
// (Cloud's default limit is 100), so callers must chunk membershipIds
// themselves for very large lists; this fetches exactly what it's given in
// one listDocuments call.
export async function listTrialsStats(membershipIds: string[]): Promise<Map<string, TrialsStatsDoc>> {
  if (membershipIds.length === 0) return new Map();
  const { Query } = await import("node-appwrite");
  const result = await (await getDatabases()).listDocuments({
    databaseId: getDatabaseId(),
    collectionId: getCollectionId(),
    queries: [Query.equal("$id", membershipIds), Query.limit(membershipIds.length)],
  });
  return new Map(result.documents.map((doc) => [doc.$id, fromDocument(doc)] as const));
}

export interface UpsertTrialsStatsInput {
  membershipId: string;
  membershipType: number;
  trialsKills: number;
  trialsDeaths: number;
  trialsActivitiesEntered: number;
  charactersChecked: number;
  lastError: string | null;
}

// No native upsert in Appwrite's Databases API: try create, fall back to
// update on a 409 (document already exists) - same pattern as
// lib/pgcr/archive.ts's putRawPgcrBytes.
export async function upsertTrialsStats(input: UpsertTrialsStatsInput): Promise<void> {
  const data = {
    membership_type: input.membershipType,
    trials_kills: input.trialsKills,
    trials_deaths: input.trialsDeaths,
    trials_activities_entered: input.trialsActivitiesEntered,
    characters_checked: input.charactersChecked,
    last_error: input.lastError,
    fetched_at: new Date().toISOString(),
  };

  const db = await getDatabases();
  try {
    await db.createDocument({
      databaseId: getDatabaseId(),
      collectionId: getCollectionId(),
      documentId: input.membershipId,
      data,
    });
  } catch (err) {
    if (!isAppwriteException(err) || err.code !== 409) throw err;
    await db.updateDocument({
      databaseId: getDatabaseId(),
      collectionId: getCollectionId(),
      documentId: input.membershipId,
      data,
    });
  }
}

// A failed fetch still stamps fetched_at (so the cron's staleness check
// doesn't retry a permanently-broken lookup every run), but must not clobber
// previously-fetched real stats with zeros just because this attempt failed.
export async function recordTrialsStatsFetchFailure(
  membershipId: string,
  membershipType: number,
  message: string
): Promise<void> {
  const existing = await getTrialsStats(membershipId);
  await upsertTrialsStats({
    membershipId,
    membershipType,
    trialsKills: existing?.trialsKills ?? 0,
    trialsDeaths: existing?.trialsDeaths ?? 0,
    trialsActivitiesEntered: existing?.trialsActivitiesEntered ?? 0,
    charactersChecked: existing?.charactersChecked ?? 0,
    lastError: message,
  });
}
