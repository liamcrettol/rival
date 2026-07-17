import type { Databases, AppwriteException as AppwriteExceptionType } from "node-appwrite";

const FRESH_MS = 14 * 24 * 60 * 60 * 1000;
const ERROR_RETRY_MS = 3 * 24 * 60 * 60 * 1000;
const COLLECTION_ID = "trials-stats";

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

let databases: Databases | null = null;
let AppwriteExceptionRef: typeof AppwriteExceptionType | null = null;

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

async function getDatabases(): Promise<Databases> {
  if (!databases) {
    const { Client, Databases: DatabasesCtor, AppwriteException } = await import("node-appwrite");
    AppwriteExceptionRef = AppwriteException;
    databases = new DatabasesCtor(new Client().setEndpoint(env("APPWRITE_ENDPOINT")).setProject(env("APPWRITE_PROJECT_ID")).setKey(env("APPWRITE_API_KEY")));
  }
  return databases;
}

function fromDocument(doc: any): TrialsStatsDoc {
  return { membershipId: doc.$id, membershipType: doc.membership_type, trialsKills: doc.trials_kills ?? 0, trialsDeaths: doc.trials_deaths ?? 0, trialsActivitiesEntered: doc.trials_activities_entered ?? 0, charactersChecked: doc.characters_checked ?? 0, lastError: doc.last_error ?? null, fetchedAt: doc.fetched_at };
}

function isNotFound(error: unknown): boolean {
  return AppwriteExceptionRef !== null && error instanceof AppwriteExceptionRef && error.code === 404;
}

export function needsTrialsStatsFetch(doc: TrialsStatsDoc | undefined | null): boolean {
  return !doc || Date.now() - new Date(doc.fetchedAt).getTime() > (doc.lastError ? ERROR_RETRY_MS : FRESH_MS);
}

export async function getTrialsStats(membershipId: string): Promise<TrialsStatsDoc | null> {
  try {
    return fromDocument(await (await getDatabases()).getDocument({ databaseId: env("APPWRITE_DATABASE_ID"), collectionId: process.env.APPWRITE_TRIALS_STATS_COLLECTION_ID || COLLECTION_ID, documentId: membershipId }));
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

export async function listTrialsStats(membershipIds: string[]): Promise<Map<string, TrialsStatsDoc>> {
  if (membershipIds.length === 0) return new Map();
  const { Query } = await import("node-appwrite");
  const db = await getDatabases();
  const databaseId = env("APPWRITE_DATABASE_ID");
  const collectionId = process.env.APPWRITE_TRIALS_STATS_COLLECTION_ID || COLLECTION_ID;

  const batches: string[][] = [];
  for (let offset = 0; offset < membershipIds.length; offset += 100) {
    batches.push(membershipIds.slice(offset, offset + 100));
  }
  // A caller with a large history (thousands of unique opponents) can produce
  // dozens of 100-id batches. Reading them one at a time made this the
  // dominant cost of a request - run them concurrently instead.
  const responses = await Promise.all(
    batches.map((batch) =>
      db.listDocuments({ databaseId, collectionId, queries: [Query.equal("$id", batch), Query.limit(batch.length)] })
    )
  );

  const result = new Map<string, TrialsStatsDoc>();
  for (const response of responses) {
    for (const doc of response.documents) result.set(doc.$id, fromDocument(doc));
  }
  return result;
}

export async function upsertTrialsStats(input: { membershipId: string; membershipType: number; trialsKills: number; trialsDeaths: number; trialsActivitiesEntered: number; charactersChecked: number; lastError: string | null }): Promise<void> {
  const db = await getDatabases();
  const params = { databaseId: env("APPWRITE_DATABASE_ID"), collectionId: process.env.APPWRITE_TRIALS_STATS_COLLECTION_ID || COLLECTION_ID, documentId: input.membershipId, data: { membership_type: input.membershipType, trials_kills: input.trialsKills, trials_deaths: input.trialsDeaths, trials_activities_entered: input.trialsActivitiesEntered, characters_checked: input.charactersChecked, last_error: input.lastError, fetched_at: new Date().toISOString() } };
  try { await db.createDocument(params); } catch (error) {
    if (!(AppwriteExceptionRef && error instanceof AppwriteExceptionRef && error.code === 409)) throw error;
    await db.updateDocument(params);
  }
}

export async function recordTrialsStatsFetchFailure(membershipId: string, membershipType: number, message: string): Promise<void> {
  const existing = await getTrialsStats(membershipId);
  await upsertTrialsStats({ membershipId, membershipType, trialsKills: existing?.trialsKills ?? 0, trialsDeaths: existing?.trialsDeaths ?? 0, trialsActivitiesEntered: existing?.trialsActivitiesEntered ?? 0, charactersChecked: existing?.charactersChecked ?? 0, lastError: message });
}
