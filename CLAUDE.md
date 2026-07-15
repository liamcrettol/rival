# CLAUDE.md - Rival

Operating guide for Claude Code. Private repo; team-visible is fine. Never
commit secret values (they live in Vercel / Supabase Vault).

The app: Destiny 2 Crucible match history and head-to-head records at
https://rival.d2roulette.app. Sister site of Rerolled (d2roulette.app); the
H2H pipeline was ported from that repo (see README for the reference docs).
Stack: Next.js 15 (App Router) / React 19 / TypeScript / Tailwind / Supabase /
NextAuth v5 beta (custom Bungie provider) / Vercel.

## Workflow

- Push to `main` deploys production (single-environment for now; if a staging
  branch model is added later, mirror Rerolled's main=staging/release=prod).
- Squash to one commit per issue before pushing. Track ad-hoc work with a
  GitHub issue closed by the commit SHA.
- Commit footer: `Co-Authored-By: Claude <model> <noreply@anthropic.com>`.
- Before every push: `npm test`, `npx tsc --noEmit`, `npm run build`.

## Invariants (don't undo)

- `lib/supabase/admin.ts` is lazy via Proxy: importing a route must not need
  the service-role key at build time. Same for the Appwrite client in
  `lib/pgcr/archive.ts`.
- All Bungie calls and all database access are server-side only. Tokens are
  encrypted at rest (`lib/auth/encrypt.ts`, `TOKEN_ENCRYPTION_KEY`).
- The importer must stay idempotent: summaries derive from uniquely keyed
  `crucible_encounters` rows, never incremented counters. Teammates are never
  encounters. Don't guess unknown teams/outcomes/modes.
- `NEXTAUTH_URL` has no trailing slash; the Bungie redirect is derived from it
  and Bungie exact-matches one redirect per app.
- H2H copy says "Recorded encounters" and never claims complete lifetime
  coverage (Bungie history availability + privacy limit it).

## Design system (same as Rerolled's flat DIM-style)

- Zero border radius, no gradients, no glassmorphism, no emoji, no webfonts.
- Tokens in globals.css / tailwind `bungie.*`: bg `#101216`, panels `#171a1f`,
  1px strokes `#2a2e36`, single accent `#00aeef` (hover `#26bcf3`).
- Reuse `.panel` and `.section-label` for every surface/section header.
- Never use em dashes anywhere in user-facing text. Use a period, comma, or
  separate sentence instead.

## Database

- `database_size_bytes()` is checked by the sync-crucible cron. At 400 MB (80%
  of the 500 MB free-tier allowance), it emits a `[database-capacity] WARNING`
  error for the existing logging pipeline.
- Plain SQL in `supabase/migrations/`, numbered sequentially, idempotent.
- Run against the live DB with `node scripts/db-query.mjs <file>` (needs your
  own `DATABASE_URL` in `.env.local`, session pooler string from the Supabase
  dashboard). Don't leave migration files unapplied.
- This is Rival's own Supabase project. Never point env vars at Rerolled's.

## Testing

- Jest, `__tests__/` mirroring source paths, node env via
  `/** @jest-environment node */` for service code. Supabase is mocked with
  the chainable `makeDb(config)` builder pattern from the ported tests.
