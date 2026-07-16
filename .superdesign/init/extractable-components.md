# Extractable Components

Rival's component surface is small and mostly page-specific. Nothing rises
to "appears identically on 3+ pages with only state/prop differences" except
the two CSS utilities, which aren't discrete React components. No layout
nav/sidebar exists to extract (see layouts.md — headers are hand-inlined per
page, not shared).

## Layout Components
None. `app/page.tsx` has no header at all; `app/dashboard/page.tsx` inlines
its own header directly in the page file. Not worth extracting for a
2-page design pass — treat each header as page-specific markup for now.

## Basic Components
### SignInButton
- Source: `components/SignInButton.tsx`
- Category: basic
- Description: Primary CTA, full-width solid `bungie-blue` button with Bungie glyph + label
- Extractable props: `returnTo` (string, optional, default: undefined) — controls the post-auth redirect target
- Hardcoded: label text, glyph SVG, all styling

### SignOutButton
- Source: `components/SignOutButton.tsx`
- Category: basic
- Description: Compact "switch account" link + "sign out" text button pair, dashboard header only
- Extractable props: none (no meaningful per-instance variation)
- Hardcoded: label text, all styling

### Spinner
- Source: `components/Spinner.tsx`
- Category: basic
- Description: Inline revolver-cylinder loading indicator
- Extractable props: `size` (number, default: 16), `className` (string, default: "")
- Hardcoded: chamber geometry/animation

Given the small surface, prefer inlining these directly in generated HTML
drafts rather than formal `create-component` extraction — extraction adds
overhead without reuse payoff here.
