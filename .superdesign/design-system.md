# Rival — Design System

## Product context
Rival (rival.d2roulette.app) is a Destiny 2 Crucible stats site: match
history and head-to-head (H2H) records against every opponent a player has
faced. Sister site of Rerolled (d2roulette.app, a weapon-loadout-roulette
game) — same studio, same visual family, shares the H2H data pipeline, but
Rival's own core idea is rivalry/stats, not loadout rolling. Design work
should give Rival a visual identity that reads as the same product family as
Rerolled (identical DIM-style flat aesthetic) while being clearly about
stats/rivalry, not roulette.

## Visual direction: flat DIM-style (verbatim, HARD CONSTRAINT)
This is inherited unchanged from Rerolled. Do not deviate.
- **Zero border radius.** Every corner is square. No `rounded-*` anywhere.
- **No gradients.** No `bg-gradient-*` fills. (The one existing exception —
  a `bg-gradient-to-r ... to-transparent` scrim behind emblem art in
  `MatchHistoryPanel` — is a subtle fade-to-transparent overlay, not a
  decorative gradient fill; don't generalize from it.)
- **No glassmorphism.** No backdrop-blur, no translucent frosted panels.
- **No emoji** in UI copy.
- **No webfonts.** System font stack only (Helvetica Neue / Segoe UI / Arial
  for sans, system mono stack for numerals).
- **No decorative shadows.** Structure comes from 1px hairline borders and
  solid fills, not elevation/shadow. (One flat exception: `shadow-2xl` on
  floating overlay panels — search results dropdown, H2H popover — because
  those escape normal document flow and need a hard edge cue against
  whatever is behind them.)

## Color tokens (bungie.* / CSS vars — the ONLY allowed colors)
| Token | Value | Use |
|---|---|---|
| `bungie.dark` / `--bungie-dark` | `#101216` | Page background |
| `bungie.surface` / `--bungie-surface` | `#171a1f` | Panel/card fill (`.panel`) |
| `bungie.border` / `--bungie-border` | `#2a2e36` | 1px hairline strokes everywhere |
| `bungie.blue` / `--bungie-blue` | `#00aeef` | Single accent: links, focus rings, active states, primary CTA fill |
| accent hover | `#26bcf3` | Hover state of the accent |

Semantic (Tailwind default palette, used narrowly for win/loss only):
- Win: `green-300` text, `green-500/10` bg, `green-500/35` border
- Loss: `red-300` text, `red-500/10` bg, `red-500/35` border
- Gray scale for text hierarchy: `gray-100` (brightest) → `gray-600` (dimmest/disabled)

Do not introduce any color outside this table. No purple/pink/orange/neon,
no additional brand hues.

## Typography
- Sans: `"Helvetica Neue", Helvetica, "Segoe UI", Arial, sans-serif` (Tailwind `font-sans`)
- Mono: `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` (Tailwind `font-mono`) — used for ALL numeric stats (W/L, K/D, scores, counts)
- Headings and section labels: uppercase, wide tracking (`tracking-[0.08em]` to `tracking-[0.22em]`), bold
- Body copy: small (`text-xs`/`text-sm`), relaxed leading, muted gray — restrained, not decorative

## Core primitives
- `.panel` — surface container: `bg-bungie-surface`, `1px solid bungie-border`, no radius, no shadow
- `.section-label` — `11px`, `700` weight, `0.14em` tracking, uppercase, `rgb(154 161 169)`
- Buttons: solid accent fill for primary actions (`bg-bungie-blue`), plain text/ghost links for secondary actions. Mechanical 1px `translateY` press on `:active`, no scale/ease bounce.
- Focus rings: `2px solid rgb(0 174 239 / 0.7)`, `1px` offset — accent color, always visible on keyboard nav.

## Layout conventions
- Content max-width `max-w-5xl` (dashboard), centered
- Landing page: single centered column, `min-h-screen` flex layout
- Dashboard header: fixed-height bar (`h-[4.5rem]`), 1px bottom border, wordmark left, actions right
- Structure via 1px hairline borders and `divide-y`, not cards-with-shadow or whitespace-only grouping
- Grids for leaderboard-style lists use `grid-cols-[explicit-track-sizes]` (not auto-fit), consistent with DIM's dense-data-table feel

## Motion (available if needed, use sparingly — Rival currently uses none of these on landing/dashboard)
- `pick-pop` (0.3s ease-out) — scale+fade in
- `slot-land` (0.5s ease-out) — accent glow ring settle
- `fade-in` (0.15s ease-out) — plain opacity fade
- `cyl-spin` (1.9s, stepped) — revolver-cylinder rotation, used by `Spinner`
- `weapon-land` (0.35s ease-out) — scale settle

## What NOT to do
- Do not add border-radius to match a "friendlier" stats-site feel — flat/square is the whole point of this design family.
- Do not add gradients, glow, or glassmorphism to differentiate Rival from Rerolled — differentiate through content/layout/motif, not through breaking the shared visual system.
- Do not introduce a webfont for a "more premium" numerals feel — the mono system stack is deliberate.
- Do not invent a logo graphic — the brand mark is the typographic wordmark "Rival" (see components.md).
