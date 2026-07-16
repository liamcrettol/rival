# Rival

Destiny 2 Crucible match history and head-to-head records, at
**https://rival.rerolled.io**. Sign in with Bungie and see your record
against every player you have faced: Trials, Competitive, Control,
Iron Banner, all of it.

Rival is the head-to-head half of the Rerolled split (see
`rerolled/docs/plans/core-slim-and-h2h-split.md`). The importer, sync
pipeline, and H2H query layer were ported from the Rerolled repo; the
reference docs for how the pipeline works are
`rerolled/docs/crucible-head-to-head-implementation.md` and
`rerolled/docs/pgcr-archive.md`.

## How it works

- Users sign in with Bungie OAuth (Rival has its own Bungie app; identity is
  the Bungie membership ID, shared with Rerolled by nature, not by session).
- Sign-in and dashboard visits queue a history sync. A pg_cron job pings
  `/api/cron/sync-crucible` every 10 minutes; each run claims queued users
  (`claim_crucible_sync`, row-locked) and walks their Bungie activity history
  one page at a time, importing PGCRs idempotently.
- Head-to-head is derived from the viewer's own imported matches: a PGCR is
  the full scoreboard, so every opponent falls out for free. Teammates are
  never counted as encounters.
- Raw PGCRs live in `pgcr_cache` with an optional Appwrite Storage archive
  behind `PGCR_ARCHIVE_*` flags.

Stack: Next.js 15 (App Router) / React 19 / TypeScript / Tailwind / Supabase /
NextAuth v5 beta (custom Bungie provider) / Vercel.

## One-time setup checklist

1. **Supabase**: create a new project (do NOT reuse Rerolled's). Run
   `supabase/migrations/001..009` in order (SQL editor, or
   `node scripts/db-query.mjs <file>` with `DATABASE_URL` in `.env.local`).
   Skip 010 until the domain is live and Vault secrets exist.
2. **Bungie app** (bungie.net/en/Application): new **Confidential** OAuth
   client, redirect `https://rival.rerolled.io/api/auth/bungie/callback`,
   scopes: read Destiny data. Note the client id, client secret, and API key.
3. **Vercel**: import this repo as a new project. Add the domain
   `rival.rerolled.io` (rerolled.io is on Vercel nameservers, so the
   subdomain just works). Set the env vars from `.env.example`.
4. **pg_cron**: add Vault secrets `cron_app_url` + `cron_secret` in the new
   Supabase project, then run migration `010_pg_cron_pings.sql`.
5. **Data migration from Rerolled** (optional but recommended): copy the
   existing imported history so early users keep their records:
   `pg_dump --data-only -t crucible_matches -t crucible_match_players
   -t crucible_match_viewers -t crucible_encounters -t pgcr_cache <rerolled db>`
   and restore into the new project. Do NOT copy `users`/`bungie_accounts`
   (tokens are encrypted with Rerolled's key and bound to its Bungie app;
   users sign in fresh here). Copy `crucible_sync_state` only if you also map
   its `user_id`s, otherwise let syncs re-enroll on first sign-in.

## Local dev

```bash
npm install
cp .env.example .env.local   # fill in values
npm run dev
```

`npm test` runs Jest, `npx tsc --noEmit` typechecks, `npm run build` is the
production build. All three must be green before pushing.
