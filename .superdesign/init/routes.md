# Routes (Next.js App Router, file-based)

| Path | File | Layout | Notes |
|---|---|---|---|
| `/` | `app/page.tsx` | `app/layout.tsx` | Signed-out landing. Redirects to `/dashboard` if session exists. |
| `/dashboard` | `app/dashboard/page.tsx` | `app/layout.tsx` | Signed-in home. Redirects to `/` if no session. `dynamic = "force-dynamic"`. |
| `/privacy` | `app/privacy/page.tsx` | `app/layout.tsx` | Static privacy policy text page. |
| `/auth/error` | `app/auth/error/page.tsx` | `app/layout.tsx` | OAuth error page. |
| `/api/*` | `app/api/**/route.ts` | — | Server-only route handlers (auth, cron, crucible data). No UI. |

## `/` — Landing page (target for this design task)
Entry: `app/page.tsx`. Server component. Checks `auth()`; if signed in,
redirects to `/dashboard`, otherwise renders the marketing/sign-in view.
Composition, top to bottom:
1. `<main>` full-height flex column, centered content, `p-8` padding.
2. Center section (`flex-1`, vertically centered): eyebrow label ("Destiny
   2" in `.section-label` + accent color) → H1 "Rival" (large uppercase
   tracked wordmark) → one paragraph of body copy → `SignInButton` in a
   `max-w-sm` wrapper.
3. Bottom row (`pt-8`): "Made by Invict Software Solutions" · "Play
   Rerolled" external link · "Privacy Policy" internal link.
No header, no nav, no product screenshot/preview — this is the gap this
design task addresses.

## `/dashboard` — Signed-in home (target for this design task)
Entry: `app/dashboard/page.tsx`. Server component. Requires session (redirect
to `/` if absent). Fetches/queues Crucible sync state and the viewer's recent
match history server-side, then renders:
1. `<header>` (see layouts.md) — wordmark, "Play Rerolled" link, display
   name, SignOutButton.
2. `<main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">`:
   - `CrucibleHistorySync` (invisible, client-side background sync trigger)
   - `OpponentSearch` (large panel: rivalry-leaderboard columns + player
     search, described fully in pages.md)
   - `MatchHistoryPanel` (list of the viewer's own recent match cards)
No aggregate "your own W/L record" summary exists anywhere on this page —
also a gap this design task addresses.
