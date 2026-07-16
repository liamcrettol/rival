# Page Dependency Trees

## / (Landing page) — PRIMARY TARGET
Entry: `app/page.tsx`
Dependencies:
- `components/SignInButton.tsx` (client component, inline Bungie glyph SVG, no further imports)
- `app/layout.tsx` (root layout — wraps in `Providers`)
  - `components/Providers.tsx` (SessionProvider only)
- `app/globals.css` (global tokens + `.panel`/`.section-label` utilities)
- `tailwind.config.ts` (theme tokens)
- Uses `next/link` (`Link`) for internal nav (Privacy Policy), plain `<a>` for external (Rerolled).

No other component imports. This is the shallowest page in the app — good
candidate for a self-contained reproduction (fits Superdesign's payload
budget easily).

## /dashboard (Dashboard) — PRIMARY TARGET (opening section)
Entry: `app/dashboard/page.tsx`
Dependencies:
- `components/CrucibleHistorySync.tsx` (client, invisible — no visual output, fires a background fetch)
- `components/SignOutButton.tsx` (client, no further imports)
- `components/crucible/OpponentSearch.tsx` (client, large — search bar + two `RivalryList` leaderboard columns + selected-player detail panel)
  - imports `components/MatchHistoryPanel.tsx` for `MatchCard` (reused to render a selected opponent's shared match reports)
    - `components/crucible/HeadToHeadChip.tsx` (the small W-L popover chip on each roster row)
    - `components/platform/LocalDateTime.tsx` (client, timezone-aware date formatting)
    - `lib/crucible/modes.ts` (label/URL helpers, not a UI file)
    - `lib/destiny/constants.ts` (`bungieImg()` URL helper, not a UI file)
  - `lib/crucible/types.ts` (type-only: `CrucibleModeBucket`, `HeadToHeadSummary`, `OpponentSearchResult`, `RivalryLeader` — needed to understand data shapes rendered)
- `components/MatchHistoryPanel.tsx` (own top-level render: viewer's own recent `MatchCard` list) — same subtree as above, already traced
- `app/layout.tsx` / `components/Providers.tsx` (root layout, shared)
- `app/globals.css`, `tailwind.config.ts` (shared tokens)
- Server-only (no visual code, safe to omit from design context): `lib/auth`, `lib/crucible/matchHistory.ts`, `lib/crucible/queueSync.ts`, `lib/crucible/sync.ts`

**Render branch note**: `app/dashboard/page.tsx` has no responsive/feature-flag
branching — it's a single unconditional render. `OpponentSearch` and
`HeadToHeadChip` do branch on client state (search results open/closed,
selected player, popover open/closed) — for the pixel-perfect reproduction,
use each component's default/closed/empty state (no query typed, no player
selected, no popover open), since that's what a fresh page load shows.

## Types referenced (not UI, but needed for context)
- `types/platform.ts` — `SeasonMatch`, `SeasonMatchPlayer`, `SeasonMatchLoadoutSlot` (shapes rendered by `MatchHistoryPanel`/`MatchCard`)
- `lib/crucible/types.ts` — `HeadToHeadSummary`, `RivalryLeader`, `OpponentSearchResult`, `CrucibleModeBucket` (shapes rendered by `OpponentSearch`/`HeadToHeadChip`)
