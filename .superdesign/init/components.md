# Components

Rival has no `components/ui/` primitive library (no shadcn/ui, no Radix). It
uses two CSS utility classes from `app/globals.css` as its shared primitives
(`.panel`, `.section-label`) plus a handful of small standalone React
components. Icons come from `lucide-react` (inline `<Icon size={n} />`, no
wrapper component).

## `.panel` (CSS utility, app/globals.css)
Flat panel surface used for every card/section container site-wide.
```css
.panel {
  background-color: var(--bungie-surface); /* #171a1f */
  border: 1px solid var(--bungie-border);   /* #2a2e36 */
}
```
Zero border-radius (no `border-radius` declared anywhere — square corners).

## `.section-label` (CSS utility, app/globals.css)
Uppercase micro-label used above every section/card header.
```css
.section-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgb(154 161 169);
}
```

## Spinner
- Source: `components/Spinner.tsx`
- Description: Inline revolver-cylinder loading spinner, six dots rotating in stepped 60° clicks, color inherits via `currentColor`.
```tsx
export default function Spinner({ size = 16, className = "" }: { size?: number; className?: string }) {
  const chambers = [0, 1, 2, 3, 4, 5].map((i) => {
    const a = ((i * 60 - 90) * Math.PI) / 180;
    return { x: 12 + 7 * Math.cos(a), y: 12 + 7 * Math.sin(a), loaded: i === 0 };
  });

  return (
    <svg
      className={`shrink-0 ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="11" stroke="currentColor" strokeWidth="1.5" className="opacity-20" />
      <g className="animate-cyl-spin origin-center">
        {chambers.map((c, i) => (
          <circle
            key={i}
            cx={c.x}
            cy={c.y}
            r="2.4"
            fill="currentColor"
            className={c.loaded ? "" : "opacity-30"}
          />
        ))}
      </g>
    </svg>
  );
}
```

## SignInButton
- Source: `components/SignInButton.tsx`
- Description: Primary CTA button, solid `bungie-blue` fill, Bungie glyph + label. Full-navigation `<a>` (OAuth entry point, not a client route).
```tsx
"use client";

export default function SignInButton({ returnTo }: { returnTo?: string } = {}) {
  const href = returnTo
    ? `/api/auth/bungie/login?returnTo=${encodeURIComponent(returnTo)}`
    : "/api/auth/bungie/login";

  return (
    <a
      href={href}
      className="w-full bg-bungie-blue hover:bg-[#26bcf3] text-white text-sm font-bold uppercase tracking-wider py-3 px-6 transition-colors flex items-center justify-center gap-2"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15v-4H7l5-8v4h4l-5 8z" />
      </svg>
      Sign in with Bungie.net
    </a>
  );
}
```

## SignOutButton
- Source: `components/SignOutButton.tsx`
- Description: Ghost text link ("Switch account") + plain text button ("Sign out"), used top-right of the dashboard header.
```tsx
"use client";

import { signOut } from "next-auth/react";

export default function SignOutButton() {
  return (
    <div className="flex items-center gap-3">
      <a
        href="/api/auth/bungie/login?reauth=true"
        className="text-xs text-gray-500 hover:text-bungie-blue transition"
        aria-label="Sign in with a different Bungie account"
      >
        Switch account
      </a>
      <button
        onClick={() => signOut({ callbackUrl: "/" })}
        className="text-sm text-gray-400 hover:text-white transition"
        aria-label="Fully sign out"
      >
        Sign out
      </button>
    </div>
  );
}
```

## No logo/brand SVG asset
`public/` has no image assets. The brand mark is text-only: `Rival` set in
`text-xl font-bold uppercase tracking-[0.12em]` (dashboard header) or
`text-5xl md:text-6xl font-bold uppercase tracking-[0.08em]` (landing H1).
Reuse this typographic mark; do not invent a logo graphic.

## Icon set
`lucide-react`, used inline, never wrapped. Icons seen across the target
pages/components: `ArrowUpRight`, `RefreshCw`, `Globe2`, `LoaderCircle`,
`Search`, `ShieldAlert`, `ShieldCheck`, `Trophy`, `X`.
