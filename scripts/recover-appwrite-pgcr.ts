#!/usr/bin/env npx tsx

import { createHash } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { Query } from "node-appwrite";
import {
  buildCrucibleMatchSource,
  buildCrucibleViewerRows,
} from "../lib/crucible/importMatch";

loadEnvConfig(process.cwd());

const endpoint = required("APPWRITE_ENDPOINT").replace(/\/+$/, "");
const projectId = required("APPWRITE_PROJECT_ID");
const apiKey = required("APPWRITE_API_KEY");
const bucketId = process.env.APPWRITE_PGCR_BUCKET_ID || "pgcr-archive";
const supabase = createClient(
  required("NEXT_PUBLIC_SUPABASE_URL"),
  required("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const BATCH_SIZE = 400;
const DOWNLOAD_CONCURRENCY = 32;
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const itemLimit = limitArg ? Math.max(0, Number(limitArg.split("=")[1])) : null;
const dryRun = process.argv.includes("--dry-run");

interface AppwriteFile {
  $id: string;
  $createdAt: string;
  $updatedAt: string;
  sizeOriginal: number;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function listUrl(queries: string[]): URL {
  const url = new URL(`${endpoint}/storage/buckets/${encodeURIComponent(bucketId)}/files`);
  for (const query of queries) url.searchParams.append("queries[]", query);
  return url;
}

async function appwriteJson<T>(url: URL): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await fetch(url, {
      headers: {
        "X-Appwrite-Project": projectId,
        "X-Appwrite-Key": apiKey,
      },
    });
    if (response.ok) return response.json() as Promise<T>;
    const message = `Appwrite ${response.status}: ${(await response.text()).slice(0, 200)}`;
    if (response.status !== 429 && response.status < 500) throw new Error(message);
    lastError = new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
  }
  throw lastError ?? new Error("Appwrite request failed");
}

async function listPrefix(prefix: string, cursor: string | null, limit = 100) {
  const queries = [Query.limit(limit), Query.startsWith("$id", prefix)];
  if (cursor) queries.push(Query.cursorAfter(cursor));
  return appwriteJson<{ total: number; files: AppwriteFile[] }>(listUrl(queries));
}

async function enumerateArchive(): Promise<AppwriteFile[]> {
  const queue = [..."0123456789"];
  const leaves: Array<{ prefix: string; total: number }> = [];

  while (queue.length > 0) {
    const batch = queue.splice(0, 25);
    const counts = await Promise.all(batch.map(async (prefix) => ({
      prefix,
      result: await listPrefix(prefix, null, 1),
    })));
    for (const { prefix, result } of counts) {
      if (result.total >= 5_000 && prefix.length < 10) {
        for (const digit of "0123456789") queue.push(prefix + digit);
      } else if (result.total > 0) {
        leaves.push({ prefix, total: result.total });
      }
    }
  }

  const partitions = await Promise.all(leaves.map(async (leaf) => {
    const files: AppwriteFile[] = [];
    let cursor: string | null = null;
    for (;;) {
      const page = await listPrefix(leaf.prefix, cursor);
      files.push(...page.files);
      if (page.files.length < 100) break;
      cursor = page.files.at(-1)!.$id;
    }
    if (files.length !== leaf.total) {
      throw new Error(`Archive partition ${leaf.prefix} changed during enumeration (${leaf.total} -> ${files.length})`);
    }
    return files;
  }));

  const files = partitions.flat();
  const unique = new Map(files.map((file) => [file.$id, file]));
  if (unique.size !== files.length) throw new Error("Duplicate Appwrite file IDs were returned");
  return [...unique.values()];
}

async function fetchAllIds(
  table: "pgcr_cache" | "crucible_matches",
  filter?: (query: any) => any,
): Promise<Set<string>> {
  const ids = new Set<string>();
  for (let from = 0;; from += 1_000) {
    let query = supabase.from(table).select("instance_id").order("instance_id").range(from, from + 999);
    if (filter) query = filter(query);
    const { data, error } = await query;
    if (error) throw new Error(`${table} inventory failed: ${error.message}`);
    for (const row of data ?? []) ids.add(String(row.instance_id));
    if ((data?.length ?? 0) < 1_000) break;
  }
  return ids;
}

async function fetchAllAccounts(): Promise<Array<{ userId: string; membershipId: string }>> {
  const accounts: Array<{ userId: string; membershipId: string }> = [];
  for (let from = 0;; from += 1_000) {
    const { data, error } = await supabase
      .from("bungie_accounts")
      .select("user_id, membership_id")
      .order("user_id")
      .range(from, from + 999);
    if (error) throw new Error(`bungie_accounts inventory failed: ${error.message}`);
    for (const row of data ?? []) {
      accounts.push({ userId: String(row.user_id), membershipId: String(row.membership_id) });
    }
    if ((data?.length ?? 0) < 1_000) break;
  }
  return accounts;
}

async function download(fileId: string): Promise<Buffer> {
  const url = `${endpoint}/storage/buckets/${encodeURIComponent(bucketId)}/files/${encodeURIComponent(fileId)}/download`;
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await fetch(url, {
      headers: {
        "X-Appwrite-Project": projectId,
        "X-Appwrite-Key": apiKey,
        Accept: "application/octet-stream",
      },
    });
    if (response.ok) return Buffer.from(await response.arrayBuffer());
    const message = `PGCR ${fileId} download failed (${response.status})`;
    if (response.status !== 429 && response.status < 500) throw new Error(message);
    lastError = new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
  }
  throw lastError ?? new Error(`PGCR ${fileId} download failed`);
}

async function mapConcurrent<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      output[index] = await worker(items[index]);
    }
  }));
  return output;
}

async function upsertChunks(table: string, rows: Array<Record<string, unknown>>, size: number, onConflict: string) {
  for (let index = 0; index < rows.length; index += size) {
    const { error } = await supabase.from(table).upsert(rows.slice(index, index + size), { onConflict });
    if (error) throw new Error(`${table} recovery upsert failed: ${error.message}`);
  }
}

async function main() {
  console.log("Enumerating Appwrite PGCR archive...");
  const allFiles = await enumerateArchive();
  const verified = await fetchAllIds("pgcr_cache", (query) => query.not("appwrite_migrated_at", "is", null));
  const existingMatches = await fetchAllIds("crucible_matches");
  const accounts = await fetchAllAccounts();
  let pending = allFiles.filter((file) => !verified.has(file.$id));
  if (itemLimit !== null) pending = pending.slice(0, itemLimit);

  console.log(JSON.stringify({
    archiveFiles: allFiles.length,
    alreadyVerified: verified.size,
    existingMatches: existingMatches.size,
    rivalAccounts: accounts.length,
    pending: pending.length,
    dryRun,
  }));
  if (dryRun || pending.length === 0) return;

  let recovered = 0;
  let importedMatches = 0;
  let unsupported = 0;
  for (let offset = 0; offset < pending.length; offset += BATCH_SIZE) {
    const files = pending.slice(offset, offset + BATCH_SIZE);
    const downloaded = await mapConcurrent(files, DOWNLOAD_CONCURRENCY, async (file) => {
      const bytes = await download(file.$id);
      const raw = JSON.parse(bytes.toString("utf8")) as unknown;
      const source = existingMatches.has(file.$id) ? null : buildCrucibleMatchSource({ rawPgcr: raw });
      return {
        file,
        bytes,
        source,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
    });

    const sources = downloaded.flatMap((item) => item.source ? [item.source] : []);
    const unsupportedInBatch = downloaded.filter(
      (item) => !item.source && !existingMatches.has(item.file.$id),
    ).length;
    const viewerBundles = sources.flatMap((source) => accounts.flatMap((account) => {
      const rows = buildCrucibleViewerRows(source, account.userId, account.membershipId);
      return rows ? [rows] : [];
    }));
    await upsertChunks("crucible_matches", sources.map((source) => source.matchRow), 100, "instance_id");
    await upsertChunks("crucible_match_players", sources.flatMap((source) => source.playerRows), 500, "instance_id,membership_id");
    await upsertChunks("crucible_encounters", viewerBundles.flatMap((rows) => rows.encounterRows), 500, "viewer_user_id,opponent_membership_id,instance_id");
    await upsertChunks("crucible_match_viewers", viewerBundles.map((rows) => rows.viewerRow), 500, "viewer_user_id,instance_id");

    const now = new Date().toISOString();
    await upsertChunks("pgcr_cache", downloaded.map(({ file, bytes, sha256 }) => ({
      instance_id: file.$id,
      source: "appwrite_recovery",
      raw_pgcr: null,
      status: "fetched",
      fetched_at: file.$updatedAt || file.$createdAt || now,
      appwrite_sha256: sha256,
      appwrite_bytes: bytes.byteLength,
      appwrite_migrated_at: now,
      appwrite_last_verified_at: now,
      updated_at: now,
    })), 100, "instance_id");

    for (const source of sources) existingMatches.add(String(source.matchRow.instance_id));
    recovered += downloaded.length;
    importedMatches += sources.length;
    unsupported += unsupportedInBatch;
    console.log(JSON.stringify({ recovered, total: pending.length, importedMatches, unsupported }));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
