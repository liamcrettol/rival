# CLAUDE.md - Rival

Operating guide for Claude Code. Private repo; team-visible is fine. Never
commit secret values (they live in Vercel / Supabase Vault).

The app: Destiny 2 Crucible match history and head-to-head records at
https://rival.rerolled.io. Sister site of Rerolled (rerolled.io); the
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

## Design system (same as Rerolled's, redesigned 2026-10-15)

- Zero border radius, no gradients, no glassmorphism, no emoji, no glow rings.
- Tokens in globals.css / tailwind `bungie.*`: bg `#0a0b0d`, panels `#121417`,
  1px strokes `#24272c`. The accent is off-white `#f2f1ed` (`bungie-blue` keeps its
  old name; solid fills take `text-bungie-dark`). No cyan.
- Type: Archivo (variable width) + IBM Plex Mono via next/font in `app/layout.tsx`.
  `.font-wide` = widened caps, for big names and titles only.
- One focal point per screen. The home hero is your most faced rival (or the
  Guardian you searched) with a huge name and record; everything else is quiet
  hairline rows. Green and red only for wins and losses.
- Reuse `.section-label` for section headers.
- Never use em dashes anywhere in user-facing text. Use a period, comma, or
  separate sentence instead.

## Database

- `database_size_bytes()` is checked by the sync-crucible cron. At 6.4 GB (80%
  of the 8 GB included with Supabase Pro), it emits a `[database-capacity]
  WARNING` error for the existing logging pipeline. Moved onto Pro on
  2026-07-21; the threshold was 400 MB against the old 500 MB free-tier cap.
- Plain SQL in `supabase/migrations/`, numbered sequentially, idempotent.
- Run against the live DB with `node scripts/db-query.mjs <file>` (needs your
  own `DATABASE_URL` in `.env.local`, session pooler string from the Supabase
  dashboard). Don't leave migration files unapplied.
- This is Rival's own Supabase project. Never point env vars at Rerolled's.
- Emblem paths are stored once in `crucible_emblems` (029a). A trigger on
  `crucible_match_players` interns `emblem_path` into `emblem_id` and nulls
  the column, so writers keep sending `emblem_path`; readers resolve
  `emblem_path` first, then `crucible_emblems.path`. Don't add new long
  strings repeated per roster row (7M+ rows).

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
