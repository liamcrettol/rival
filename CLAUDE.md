# CLAUDE.md - Rival

Operating guide for Claude Code. Private repo; team-visible is fine. Never
commit secret values (they live in Vercel and in mode-600 files on the
database server).

**Rival's database left Supabase on 2026-10-16.** It is now Postgres +
PostgREST on AWS Lightsail at `https://db.rerolled.io`. Read
[docs/INFRASTRUCTURE.md](docs/INFRASTRUCTURE.md) before touching the
database, env vars, migrations or cron jobs.

The app: Destiny 2 Crucible match history and head-to-head records at
https://rival.rerolled.io. Sister site of Rerolled (rerolled.io); the
H2H pipeline was ported from that repo (see README for the reference docs).
Stack: Next.js 15 (App Router) / React 19 / TypeScript / Tailwind / PostgREST (supabase-js) /
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

## Design system: mida.tools

Follow [the shared MIDA brief](docs/MIDA_DESIGN_BRIEF.md). The approved hub is minimal and names-first. Use Archivo 400/500/600, neutral light/dark tokens, plain text actions, generous spacing and a small orange signal. No tape treatments, decorative logos, gradients, shadows or uppercase labels. Theme defaults to the system and the browser remembers the choice. Preserve all existing tool behavior and semantic game information.

## Database

- **Host:** AWS Lightsail `rival-db` (us-east-1, same AWS region as Vercel
  `iad1`), running `supabase/postgres` 17.6 + PostgREST v14.17 behind Caddy at
  `https://db.rerolled.io`. `supabase-js` and the `SUPABASE_*` env names are
  unchanged: "Supabase" in this codebase now means that PostgREST server.
  Full details, runbooks and open items: [docs/INFRASTRUCTURE.md](docs/INFRASTRUCTURE.md).
- The old Supabase project (`gnlnoojuudcjbifjfjyr`) is **retired** and kept
  only as a fallback. `DATABASE_URL` and `scripts/db-query.mjs` still point at
  it, so **don't use them**.
- Plain SQL in `supabase/migrations/`, numbered sequentially, idempotent.
  Apply on the Lightsail server with `docker compose exec db psql -U
  supabase_admin` (see docs/INFRASTRUCTURE.md section 6). Test triggers and
  other DDL in `begin; ... rollback;` first. Don't leave migration files
  unapplied.
- Never point env vars at Rerolled's Supabase except the existing
  `REROLLED_SUPABASE_*` roster read.
- `anon` and `authenticated` have no grants in `public`; only `service_role`
  is used. Grant `service_role` on anything new.
- Rival's client times out at 1.2 s by default. Check new or changed queries
  with pg_stat_statements (role `service_role`) on the server.
- `database_size_bytes()` is checked by the sync-crucible cron and warns at
  6.4 GB (the old Supabase Pro threshold). The real limit is now the 60 GB
  Lightsail disk; the threshold is due an update.
- Emblem paths are stored once in `crucible_emblems`. The trigger
  (migration 031) sets `emblem_id` on INSERT but keeps `emblem_path`, so an
  `ON CONFLICT DO UPDATE SET emblem_path = excluded.emblem_path` still carries
  it. On UPDATE it interns and nulls the path, and never erases an existing
  emblem. Readers resolve `emblem_path` first, then `crucible_emblems.path`.
  Don't add new long strings repeated per roster row (7M+ rows).
- Membership and instance IDs stay **text**: they exceed 2^53 and would
  corrupt as JSON numbers. `crucible_encounters` stays a real table (deriving
  it live took 22 s).

## Testing

- Jest, `__tests__/` mirroring source paths, node env via
  `/** @jest-environment node */` for service code. Supabase is mocked with
  the chainable `makeDb(config)` builder pattern from the ported tests.
- For a change that needs real browser verification beyond what the sandboxed
  preview supports (e.g. an actual Bungie OAuth redirect round-trip), use the
  `playwright` MCP server rather than trying to fake it in Jest.

## Superdesign skill (design exploration only, not implementation)

Reach for the `superdesign` skill for real design work — a new page/flow that
doesn't have a design yet, visual variants, or component extraction. Not for
implementation-only tickets (its own trigger rule says so); do those as
ordinary code changes.

- External CLI (`npx --yes @superdesign/cli@latest`), talks to
  superdesign.dev; first use needs an interactive `... login`. Never pass
  secrets, tokens, or real player data through `--context-file`/`-p` — same
  caution as any other external service.
- First run here builds `.superdesign/init/` before any design work —
  expected. Confirm `.superdesign/tmp/` lands in `.gitignore`.
- **This repo shares Rerolled's design system verbatim** (see the "Design
  system" section above: zero border radius, no gradients/glassmorphism, the
  `bungie.*` tokens). Write `.superdesign/design-system.md` from that section
  plus this repo's real `globals.css`/`tailwind.config.ts` — don't let the
  tool default to a generic SaaS look just because Rival's current landing
  page is sparse. Sparse isn't the same as undesigned; match Rerolled's flat
  DIM aesthetic, don't invent a new brand for Rival.
- **Biggest opportunity in this repo**: everything past sign-in (match
  history, head-to-head comparison, player profile) was ported from
  Rerolled's old dashboard as data plumbing and has never had a design pass
  of its own. Once the landing page (or a first page) has an approved draft,
  use `execute-flow-pages` to generate the rest of that flow styled after it.
- Always reproduces the current UI pixel-perfectly before proposing
  variations (the skill's own hard rule) — don't skip that step.

## Other installed plugins (local to this repo, 2026-07-16)

All three below are installed at **local scope** (`.claude/settings.local.json`,
gitignored, personal to this checkout) — not active in other projects on this machine.

- **Superpowers** (`obra/superpowers-marketplace`) adds hard-worded skills:
  `brainstorming` (design approval gate before creative work), `test-driven-development`,
  `systematic-debugging`, `verification-before-completion`, plus `using-git-worktrees` and
  code-review dispatch skills. Good defaults, but don't let the brainstorming/TDD gate add
  ceremony to small, clearly-scoped fixes — reserve it for genuinely new features or
  ambiguous asks.
- **`static-analysis`** (semgrep/codeql) is available for a manual security-audit pass —
  relevant here given Bungie token handling and server-side DB access. Neither CLI is
  installed on this machine yet (`pip install semgrep`; CodeQL needs the CLI bundle from
  github.com/github/codeql-cli-binaries). Both gate on explicit approval before scanning.
- **`karpathy-guidelines`** reinforces conventions already in this file (surgical diffs,
  no speculative abstractions) — no reconciliation needed.
