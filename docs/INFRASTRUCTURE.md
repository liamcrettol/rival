# Infrastructure: where Rerolled, Replay and Rival's data lives

Read this before touching any database, env var, migration, cron job or
hosting setting for **Rival**, **Rerolled** or **Replay**. It is the single
source of truth for the split hosting set up on 2026-10-16 (rerolled#429,
rival#51). Last verified: 2026-10-16.

If something here disagrees with what you observe, trust the live system,
fix this file, and say so in your summary.

---

## 1. The one-paragraph version

The three sites run on **Vercel** (Hobby plan, account `liamncrettol`).
**Rerolled** and **Replay** share one **Supabase** project and will move to
Supabase's **Free** plan. **Rival** moved off Supabase on 2026-10-16 to a
self-run **Postgres + PostgREST** server on **AWS Lightsail** at
`https://db.rerolled.io`. Rival's code still uses `supabase-js`, because
PostgREST is the same API Supabase uses, so nothing in Rival's code knows it
left. The goal was to cut the bill from about $35/month to about $14/month.

```
                    Vercel (iad1 = AWS us-east-1)
   +----------------+   +----------------+   +------------------+
   | rerolled.io    |   | replay.        |   | rival.rerolled.io|
   | (Rerolled)     |   | rerolled.io    |   | (Rival)          |
   +-------+--------+   +-------+--------+   +---+----------+---+
           |                    |                |          |
           | supabase-js        | supabase-js    |          | supabase-js
           | + Realtime         | db.schema=     |          | (PostgREST)
           v                    v  "replay"      |          v
   +--------------------------------------+     |   +---------------------+
   | Supabase project "rerolled"           |<----+   | AWS Lightsail       |
   | rygyojxgngptacyadrna                  | roster  | rival-db            |
   |  public schema  = Rerolled            | read    | db.rerolled.io      |
   |  replay schema  = Replay              |         | Postgres 17.6       |
   |  pg_cron + pg_net + Vault pings       |         | PostgREST v14.17    |
   +--------------------------------------+         | Caddy (HTTPS)       |
                                                     +---------------------+
   Supabase project "rival" (gnlnoojuudcjbifjfjyr): RETIRED 2026-10-16.
   Kept read-only as a fallback, no cron jobs. Delete after a quiet week.
```

---

## 2. Which project lives where, and why

| App | Database | Why there |
|---|---|---|
| **Rerolled** | Supabase project `rerolled`, `public` schema | Uses Supabase features beyond Postgres: **Realtime** channels in the browser (`hooks/useSupabaseChannel.ts`, `lib/lobby/realtimeState.ts`, lobby and draft state), a browser client (`lib/supabase/client.ts`), and pg_cron + pg_net + Vault pings. Small (about 29 MB). Moving it would mean rebuilding Realtime. |
| **Replay** | Same Supabase project, `replay` schema (admin client sets `db.schema = "replay"`) | Small (about 99 MB and growing with Kudo, Obolus and Kaiuzo's backfill). Server-side only, Vercel cron for syncing (no pg_cron). Sharing Rerolled's project costs nothing extra. |
| **Rival** | AWS Lightsail `rival-db`, `public` schema | About 4.9 GB on Supabase (3.8 GB after restore). It alone forced Supabase Pro ($25) plus a second project's compute ($10). Uses only the service-role REST API (no Auth, Storage, Realtime or browser client), so plain PostgREST is a drop-in. |

### Rules that follow from this

- **Never** put Rival's data back in Supabase, or Rerolled's or Replay's on
  Lightsail, without a new decision from Liam.
- **Never** read or write Rerolled's `public` schema from Replay, or Replay's
  `replay` schema from Rerolled.
- Rival **reads** Rerolled's Supabase (the user roster) through
  `REROLLED_SUPABASE_URL` / `REROLLED_SUPABASE_SERVICE_ROLE_KEY`
  (`lib/crucible/siteRoster.ts`). That link is unchanged and still needed.
- Rerolled talks to Rival over **HTTP** only (`RIVAL_BASE_URL`,
  `RIVAL_SYNC_SECRET`), and Rival to Rerolled the same way
  (`REROLLED_SYNC_BASE_URL`, `REROLLED_SYNC_SECRET`). No direct database
  access between the two Postgres servers.

---

## 3. Costs (US dollars)

| Item | Before | After |
|---|---|---|
| Supabase org | Pro $25 + second project compute $10 = **$35** | **Free $0** once the Rival project is deleted |
| AWS Lightsail `rival-db` (2 GB, `small_3_0`) | n/a | **$12** |
| Lightsail automatic snapshots | n/a | about $1 to $3 |
| **Total** | **about $35/month** | **about $14/month** |

The AWS account is on the **6-month Free plan** with credits (about $100 to
$200), so it costs nothing out of pocket for a while. **It must be upgraded to
the paid plan before the Free plan ends, or AWS closes the account and Rival
goes down.** See section 9.

---

## 4. Rival's database server (AWS Lightsail)

### Facts

| Thing | Value |
|---|---|
| AWS account | `650836812200`, signed in as the **root user** (see open items) |
| Region / zone | `us-east-1` / `us-east-1a`, the same AWS region as Vercel `iad1`, where Rival's functions run |
| Instance | `rival-db`, bundle `small_3_0` (2 vCPU, 2 GB RAM, 60 GB SSD), Ubuntu 24.04 |
| Static IP | `34.225.240.192` (`rival-db-ip`) |
| DNS | `db.rerolled.io` A record pointing to that IP, in **Vercel DNS** (rerolled.io's nameservers are Vercel's) |
| Firewall | 22 only from `97.117.107.55/32` (Liam's home IP), 80 and 443 open, **5432 closed** |
| SSH | `ssh -i ~/.ssh/rival-lightsail ubuntu@34.225.240.192`. The private key exists **only on Liam's PC**. |
| Snapshots | Automatic daily at 08:00 UTC, plus manual `rival-db-after-cutover-2026-10-16` |
| Other on-box setup | 2 GB swap, unattended security upgrades, Docker 29, Compose v5 |

### What runs (`~/rival-db/docker-compose.yml`)

- **`db`**: `supabase/postgres:17.6.1.136`. This is Supabase's own Postgres
  image, so `anon`, `authenticated`, `service_role`, `authenticator`, the
  `extensions` schema, pg_trgm, uuid-ossp, pg_cron and pg_net all exist like
  on Supabase. No published ports. Tuned for 2 GB: `shared_buffers=512MB`,
  `effective_cache_size=1280MB`, `work_mem=8MB`, `max_connections=60`.
- **`rest`**: `postgrest/postgrest:v14.17`, with settings copied from
  Supabase's hosted ones so query results match:
  - `PGRST_DB_SCHEMAS=public`
  - `PGRST_DB_MAX_ROWS=1000` (Supabase's cap; code may rely on it)
  - `PGRST_DB_EXTRA_SEARCH_PATH=public,extensions`
  - `PGRST_DB_ANON_ROLE=anon`
  - `PGRST_JWT_SECRET` from `.env`
- **`caddy`**: `caddy:2`, automatic Let's Encrypt certificate. The
  `Caddyfile` sends `db.rerolled.io/rest/v1/*` to PostgREST (stripping
  `/rest/v1`, which is the path `supabase-js` uses) and returns 404 for
  everything else.

### Files on the server (`/home/ubuntu/rival-db/`)

| File | What it is |
|---|---|
| `.env` (600) | `POSTGRES_PASSWORD`, `JWT_SECRET`. Generated on the box, never printed. |
| `service-role.jwt` (600) | The HS256 `service_role` JWT, valid 10 years. It is Rival's `SUPABASE_SERVICE_ROLE_KEY`. |
| `cron.env` (600) | `CRON_SECRET` for the reconcile job. **Currently wrong** (see open items). |
| `reconcile.sh` | Calls `GET https://rival.rerolled.io/api/cron/reconcile-pgcr` with the cron secret |
| `start.sh` | Creates `.env` if missing, pulls images, starts the stack, waits for healthy |
| `copy-from-supabase.sh` | The dump-and-restore used for the move (asks for a connection string, hidden) |
| `cutover.sh` | Wipes the database volume and runs a fresh copy. **Destructive; only for a re-migration.** |
| `set-cron-secret.sh` | Re-enter `CRON_SECRET` (hidden) and test it against production |
| `repair-emblems.sh` | Re-fetches match reports from Bungie to restore lost emblems (asks for `BUNGIE_API_KEY`, hidden) |
| `smoke.mjs` | Read-only test of Rival's real `supabase-js` queries |

### Crontab (`ubuntu` user)

```
7 * * * * $HOME/rival-db/reconcile.sh >> $HOME/rival-db/reconcile.log 2>&1
```

pg_cron exists in the image but is **not enabled** on this database (no
`create extension pg_cron`). Scheduled work runs from the host crontab
instead, which avoids needing Vault and pg_net.

### Security model

- Rival only ever uses the **service key**: server-side, through
  `lib/supabase/admin.ts`. Rival has no browser Supabase client.
- `anon` and `authenticated` have **no** grants on any table, sequence or
  function in `public`. Default privileges were changed too. Requests without
  the key get **401 or "permission denied"**. RLS is on for every table with
  no policies, as on Supabase.
- `service_role` has `BYPASSRLS` plus grants on everything in `public`.
- If you add a table or function, it is created as `supabase_admin` or
  `postgres`, and default privileges no longer give `anon` access. Grant
  `service_role` explicitly if needed (see section 7).

---

## 5. How Rival is wired on Vercel

| Variable | Production | Preview |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://db.rerolled.io` (**Config** type) | same row, shared with Production |
| `SUPABASE_SERVICE_ROLE_KEY` | new Lightsail key (**Secret**) | new Lightsail key (**Secret**, separate row) |
| `DATABASE_URL` | **Still points at the retired Supabase project.** Do not use it. Only `scripts/db-query.mjs` reads it. | not set |
| `REROLLED_SUPABASE_URL`, `REROLLED_SUPABASE_SERVICE_ROLE_KEY` | Rerolled's Supabase (unchanged) | same |
| `CRON_SECRET` | Production only | not set |

Vercel gotchas we hit:

- A variable named `NEXT_PUBLIC_*` must be **Config**, not Secret. Vercel
  can't change a variable's type in place, so delete it and add it again.
- Vercel won't build a new branch whose commit it has already deployed. Push
  an empty commit to get a Preview.
- **Previews can't sign in.** Bungie OAuth only allows the redirect back to
  `rival.rerolled.io`, so test logged-in pages on production.

The names still say "SUPABASE". That's intentional: renaming would touch
every file for no benefit. **"Supabase" in Rival's code now means "our
PostgREST server".**

---

## 6. How to do common things on Rival's database

All commands run on the server (`ssh` from section 4), in `~/rival-db`.

### Open a SQL prompt

```bash
docker compose exec db psql -U supabase_admin -d postgres
```

`supabase_admin` is the superuser. `postgres` is **not** a superuser in this
image.

### Apply a migration

Rival's `CLAUDE.md` used to say "run with `node scripts/db-query.mjs`". **That
now hits the retired Supabase project.** Instead:

```bash
scp -i ~/.ssh/rival-lightsail supabase/migrations/0NN_x.sql ubuntu@34.225.240.192:/tmp/
ssh -i ~/.ssh/rival-lightsail ubuntu@34.225.240.192 \
  'cd ~/rival-db && docker compose cp /tmp/0NN_x.sql db:/tmp/m.sql && docker compose exec -T db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -f /tmp/m.sql </dev/null'
```

- `CREATE INDEX CONCURRENTLY` must run on its own (`-c`), not inside a file
  that psql runs as one transaction.
- After schema changes PostgREST reloads its schema cache automatically
  (`pgrst` NOTIFY channel). If an API call says a column or function doesn't
  exist, run `docker compose restart rest`.
- **Inside heredoc scripts, add `</dev/null` to every
  `docker compose exec -T`**, or it swallows the rest of the script as stdin.
  This bit us once and silently skipped every remaining step.

### Check health and logs

```bash
docker compose ps
docker compose logs rest --tail 50
docker compose logs caddy --tail 50
df -h /           # 60 GB disk; DB was 3.8 GB at cutover
free -h
```

### See what Rival is doing and how fast

pg_stat_statements is on. Rival's queries run as **`service_role`** (PostgREST
logs in as `authenticator` and switches role):

```sql
select calls, round(mean_exec_time) avg_ms, round(max_exec_time) max_ms,
       left(regexp_replace(query, '\s+', ' ', 'g'), 150)
from pg_stat_statements s join pg_roles r on r.oid = s.userid
where r.rolname = 'service_role'
order by max_exec_time desc limit 20;
-- reset: select pg_stat_statements_reset();
```

Rival's client gives up after **1.2 s** by default (`SUPABASE_REQUEST_TIMEOUT_MS`).
Some paths pass 5 s or 25 s. Anything near those limits is a bug.

### Restart, update, and recover

- **Restart:** `docker compose restart` (or one service).
- **Update images:** check Supabase's official `docker/docker-compose.yml`
  for the current `supabase/postgres` and `postgrest` tags, edit, then
  `docker compose pull && docker compose up -d`. **Never jump the Postgres
  major version this way**; that needs a dump and restore.
- **Server lost:** create an instance from the latest snapshot (Lightsail >
  Snapshots), move the static IP to it, done.
- **Data lost:** only Lightsail snapshots exist right now (section 9).

### Test that Rival's API still works

```bash
cd ~/smoke && SERVICE_KEY="$(cat ~/rival-db/service-role.jwt)" \
  docker run --rm -e SERVICE_KEY -v ~/smoke:/app -w /app node:22-alpine node smoke.mjs
```

---

## 7. Schema facts that are easy to break (Rival)

- **Emblems are stored once.** `crucible_emblems(id, path)` holds each emblem
  path once. `crucible_match_players.emblem_id` points to it. Trigger
  `crucible_match_players_intern_emblem` runs `intern_crucible_player_emblem()`
  (migration **031**):
  - **INSERT:** sets `emblem_id` from `emblem_path` but **keeps the path**.
    It must, because `importMatch.ts` upserts with `ON CONFLICT DO UPDATE SET
    emblem_path = excluded.emblem_path`, and EXCLUDED is the row after BEFORE
    INSERT triggers. The original 029a version nulled it here and silently
    erased emblems on every re-import (fixed 2026-10-16; 106 restored from
    Bungie, see `repair-emblems.sh`).
  - **UPDATE:** interns the incoming path, then nulls `emblem_path`. An update
    without an emblem never erases an existing one.
  - Readers resolve `emblem_path` first, then `crucible_emblems.path`
    (`withResolvedEmblem` in `lib/crucible/matchHistory.ts`, and both
    identity functions).
  - The one-off backfill (029b) stopped at about 1.03M rows (`last_instance_id
    = '11916731637'`, **text** ordering). The rest still hold inline paths,
    which is correct, just bigger. `backfill_crucible_player_emblems(rows)`
    and the `crucible_emblem_backfill` table exist on Lightsail to finish it.
    Run it in batches; it fires the trigger and FK check on each row (about
    1.2 ms per row).
  - Bungie puts emblems at `entries[].player.destinyUserInfo.iconPath`
    (sometimes `emblemPath`). See `lib/pgcr/parse.ts`.
- **Identity lookups are indexed.** `get_latest_player_identities` and
  `get_latest_player_emblems` (migration **030**) walk
  `crucible_match_players_member_updated_idx (membership_id, updated_at desc)`
  newest-first with `LIMIT 1` per player. The old full sort took 3 to 6 s per
  call (101 s for all 100 site users) and made rosters fall back to initials.
  Keep the same tie-break order if you change them; 030 was verified to match
  the old logic on a 300-player sample.
- **IDs are text on purpose.** Membership IDs exceed 2^53. Turning them into
  `bigint` would corrupt them in `supabase-js` JSON. Don't "optimise" this.
- **`crucible_encounters` must stay a real table.** Deriving it on the fly
  from viewers plus players took **22 s** for the heaviest user.
- **Indexes removed in 028:** `crucible_encounters_mode_idx` (4 scans) and
  `crucible_match_players_team_idx` (covered by `member_idx`). Don't re-add
  them without scan evidence.
- **Viewer materialization is incremental** (migration **032**).
  `materialize_sitewide_crucible_viewers(p_user_ids)` only processes a user's
  matches that have no `crucible_match_viewers` row yet, or whose
  `crucible_matches.updated_at` moved past the viewer row's
  `encounters_checked_at` (falling back to `created_at`). It then stamps
  `encounters_checked_at`. The heaviest user (30,835 matches) went from
  1.8 s warm or 10 to 14 s cold to **0.3 s**, with byte-identical results
  (fingerprint test). The first run per user is slow (about 17 s for the
  heaviest), so all existing users were run once by
  `~/rival-db/settle-materialize.sh` on 2026-10-16. The `p_user_ids is null`
  (last hour) cron path is unchanged. **Anything that re-imports a match must
  bump `crucible_matches.updated_at`**, or its encounters won't be re-derived.
- Never run `materialize_sitewide_crucible_viewers` for all users at once on
  the live server; even read-heavy, it saturates the 2 GB box for minutes.
- `database_size_bytes()` and the `[database-capacity]` alarm in the
  sync-crucible cron still use the Supabase Pro threshold (6.4 GB of 8 GB).
  The real limit now is the 60 GB disk. Update the threshold when convenient.

### Migration state as of 2026-10-16

| Migration | Rival Supabase (retired) | Lightsail (live) |
|---|---|---|
| 001 to 027 | applied | applied (came with the dump) |
| 028 drop redundant indexes | applied | applied (came with the dump) |
| 029a emblems table + trigger | applied | applied (came with the dump), then replaced by 031 |
| 029b emblem backfill | partly run, cron removed | functions and state table present, not scheduled |
| 030 fast identity lookups | **not applied** | applied |
| 031 emblem trigger fix | **not applied** | applied |
| 032 incremental viewer materialization | **not applied** | applied |

---

## 8. Rerolled and Replay on Supabase

- Project `rerolled` (`rygyojxgngptacyadrna`), org `liamcrettol`, currently on
  **Pro** and moving to **Free** once Rival's project is deleted.
- Measured 2026-10-15: `public` about 29 MB, `replay` about 99 MB, about 112 MB
  total on disk. **Free caps the database at 500 MB.**
- **Replay's backfill is the growth risk.** Add a size alert well below 500 MB.
  Rerolled's `CLAUDE.md` capacity alarm also uses the Pro threshold and needs
  lowering after the downgrade.
- Free projects pause after about a week of low activity. Rerolled's pg_cron
  pings (`ping-cleanup-lobbies` */15, `ping-detect-games` */30,
  `ping-process-jobs` */15) and Replay's daily Vercel cron keep it busy, but
  check the dashboard if the sites ever stop answering.
- Free has **no automatic backups**. A nightly `pg_dump` of this project
  should go somewhere too (the same R2 plan as Rival).
- Workflows are unchanged:
  - **Rerolled:** `main` deploys to staging (`preview.rerolled.io`),
    `release` to production. Never push to `release` without Liam saying "ship it".
  - **Replay:** push to `main` is production. Plain SQL migrations in
    `supabase/migrations/`, each starting with `set search_path to replay;`.

---

## 9. Open items (in priority order)

1. **Upgrade AWS to the paid plan.** The Free plan closes the account after
   6 months or when credits run out, and the data is deleted later. Billing
   console, then upgrade. Leftover credits keep paying the bill. Also set an
   AWS Budget alert (for example $20/month).
2. **Backups off the server.** Only Lightsail snapshots exist (same provider,
   same account). Planned: nightly `pg_dump -Fc -n public` to a Cloudflare R2
   bucket via `rclone` (installed, not configured), keeping about 5 days within
   R2's free 10 GB. The steps are in Step 7 of
   `C:\Users\liamc\Documents\Rival-Lightsail-Move.md`. Test a restore once.
3. **Fix the cron secret.** `cron.env` holds an 11-character value (the
   variable's *name* was pasted), so the hourly reconcile gets 401. Run
   `./set-cron-secret.sh` and paste the *value* of `CRON_SECRET`.
4. **Retire the Supabase Rival project** after a week with no problems:
   final dump to R2, delete project `gnlnoojuudcjbifjfjyr`, delete preview
   branches, then switch the org to Free.
5. **Remove the stale `DATABASE_URL`** from Rival's Vercel env and
   `.env.local`, and change `scripts/db-query.mjs` (or replace it) so it can't
   hit the retired project by accident.
6. **Stop using the AWS root user.** Create an IAM Identity Center or IAM user
   with Lightsail permissions for day-to-day and agent use.
7. **Home IP dependency.** SSH is allowed only from `97.117.107.55`. If that
   changes, update the firewall in the Lightsail console (Networking tab),
   which also offers a browser SSH button. The SSH key lives only on Liam's
   PC; back it up somewhere safe.
8. **rerolled.io auto-renew is OFF** (expires 2027-07-16). If it lapses, all
   three sites go down. Turn it on in Vercel > Domains.
9. **Unscheduled Rival jobs.** Before the move, only `ping-reconcile-pgcr` was
   scheduled on Supabase. `sync-crucible`, `sync-trials-kd` and the
   `trials_backfill_candidates` refresh from older migrations were not running.
   Decide whether they should be, then add them to the server crontab the same
   way as reconcile.
10. The `preview-lightsail` branch on GitHub can be deleted.

---

## 10. Decision record: options considered and why they lost

| Option | Verdict | Evidence |
|---|---|---|
| Fit Rival into Supabase Free (500 MB) by slimming | Rejected | Real sizes: players 2.5 GB, encounters 1.4 GB, raw PGCRs only 243 MB. Even fully slimmed, about 900 MB. |
| Slimming tricks | Partly done | Dropped 2 indexes (309 MB), emblem dedupe (about 450 MB). Encounters as a view: 22 s, rejected. bigint IDs: break JSON precision, rejected. |
| Merge Rival into Rerolled's Supabase project | Fallback | About $25/month, zero upkeep. Lost on cost. |
| Hetzner (EU, about $7) | Rejected | Cheap plans are Europe-only and were capacity-restricted. US plans cost about $21 to $38. Region far from Vercel `iad1` given the 1.2 s timeout. Strict signup checks. |
| Oracle Always Free | Rejected | ARM allowance cut June 2026. Idle VMs get reclaimed. Capacity lottery. |
| Neon | Rejected | Always-on 0.25 CU is about $20/month. No service-role equivalent in its Data API. |
| PlanetScale Postgres $5 | Rejected | 512 MB RAM. No pg_net or PostgREST, so about 25 files would need rewriting. |
| Aiven $5 Developer | Rejected | 20 connections, no region choice, no PostgREST. |
| Railway, Render, DigitalOcean managed | Rejected | About $12 to $19, still no PostgREST, unmanaged or too small. |
| **AWS Lightsail us-east-1 + Postgres + PostgREST** | **Chosen** | Same AWS region as Vercel `iad1`, so queries stay fast. No code changes. $12 in USD. No capacity issues. |
| `supabase db dump` to move data | Failed | Schema step rejected the session pooler string ("Invalid format for user or db_name"). Used `pg_dump --schema=public -Fc` and `pg_restore` from the same image instead (5 minutes, 402 MB dump, every count matched). |

---

## 11. Rules for agents, in short

1. Rival's database is **Lightsail**, not Supabase. `DATABASE_URL` and
   `db-query.mjs` point at the retired project. Use section 6.
2. Rerolled and Replay stay on **Supabase**. Respect the schema split and
   Rerolled's staging-first deploys.
3. Never print, log or commit secrets. On the server they live in
   `.env`, `service-role.jwt` and `cron.env` (all mode 600). When Liam has to
   enter a secret, use a hidden `read -s` prompt in a terminal he can see.
   Never ask for one in chat.
4. Test DDL in a `begin; ... rollback;` block first, especially triggers.
   The 029a bug only showed up on the `ON CONFLICT` path.
5. After any Rival schema change, check timings with pg_stat_statements
   (section 6) against the 1.2 s client limit.
6. Changing Vercel env vars needs a redeploy. Production and Preview are
   separate rows.
7. Before deleting anything (Supabase project, snapshots, volumes), confirm
   with Liam. `cutover.sh` wipes the live database volume.
8. Keep this file current. It's the handoff document.
