# Theme / Design Tokens

Rival deliberately reuses Rerolled's (sister site, d2roulette.app) flat
DIM-style design system verbatim. Do not invent new tokens.

## Hard rules (from repo CLAUDE.md)
- Zero border radius anywhere. No gradients. No glassmorphism. No emoji. No webfonts.
- Single accent color: `#00aeef` (hover `#26bcf3`).
- Reuse `.panel` and `.section-label` for every surface/section header.
- Never use em dashes in user-facing text.

## Full `app/globals.css`
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --bungie-blue: #00aeef;
  --bungie-dark: #101216;
  --bungie-surface: #171a1f;
  --bungie-border: #2a2e36;
}

body {
  background-color: var(--bungie-dark);
  color: #e8eaed;
}

::selection {
  background-color: rgb(0 174 239 / 0.35);
  color: #fff;
}

/* Slim dark scrollbars — the OS default light bar breaks the theme on Windows. */
* {
  scrollbar-width: thin;
  scrollbar-color: rgb(42 46 54) transparent;
}
*::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
*::-webkit-scrollbar-thumb {
  background-color: rgb(42 46 54);
}
*::-webkit-scrollbar-thumb:hover {
  background-color: rgb(64 70 80);
}
*::-webkit-scrollbar-track {
  background: transparent;
}

/* Keyboard-visible focus ring in the accent color, everywhere. */
:focus-visible {
  outline: 2px solid rgb(0 174 239 / 0.7);
  outline-offset: 1px;
}

/* Mechanical 1px press on every button — no scaling, no easing. */
button {
  -webkit-tap-highlight-color: transparent;
}
button:not(:disabled):active {
  transform: translateY(1px);
}

@layer utilities {
  .exotic-border {
    border-color: #c7a64a;
  }
  .legendary-border {
    border-color: #522f65;
  }
  /* Flat panel: solid fill, hard edges, 1px stroke. */
  .panel {
    background-color: var(--bungie-surface);
    border: 1px solid var(--bungie-border);
  }
  /* Uppercase micro-label used for every section header. */
  .section-label {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: rgb(154 161 169);
  }
}
```

## Full `tailwind.config.ts`
```ts
import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      // System grotesque stack (same family DIM ships) — no webfont payload.
      fontFamily: {
        sans: ['"Helvetica Neue"', "Helvetica", '"Segoe UI"', "Arial", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      colors: {
        bungie: {
          blue: "#00aeef",
          dark: "#101216",
          surface: "#171a1f",
          border: "#2a2e36",
        },
      },
      keyframes: {
        "pick-pop": {
          "0%": { transform: "scale(0.85)", opacity: "0.4" },
          "60%": { transform: "scale(1.06)", opacity: "1" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
        "slot-land": {
          "0%":   { boxShadow: "0 0 0 0 rgba(0,174,239,0)" },
          "30%":  { boxShadow: "0 0 0 2px rgba(0,174,239,0.6)" },
          "100%": { boxShadow: "0 0 0 0 rgba(0,174,239,0)" },
        },
        "fade-in": {
          "0%":   { opacity: "0" },
          "100%": { opacity: "1" },
        },
        // Revolver cylinder: six discrete 60° clicks per revolution - move
        // fast, then hold, like thumbing a cylinder round by round.
        "cyl-spin": {
          "0%":             { transform: "rotate(0deg)" },
          "9%, 16.66%":     { transform: "rotate(60deg)" },
          "25.66%, 33.33%": { transform: "rotate(120deg)" },
          "42.33%, 50%":    { transform: "rotate(180deg)" },
          "59%, 66.66%":    { transform: "rotate(240deg)" },
          "75.66%, 83.33%": { transform: "rotate(300deg)" },
          "92.33%, 100%":   { transform: "rotate(360deg)" },
        },
        "weapon-land": {
          "0%":   { transform: "scale(0.96)" },
          "55%":  { transform: "scale(1.03)" },
          "100%": { transform: "scale(1)" },
        },
      },
      animation: {
        "pick-pop":  "pick-pop 0.3s ease-out",
        "slot-land": "slot-land 0.5s ease-out forwards",
        "fade-in":   "fade-in 0.15s ease-out forwards",
        "cyl-spin":  "cyl-spin 1.9s cubic-bezier(0.34, 1.4, 0.64, 1) infinite",
        "weapon-land": "weapon-land 0.35s ease-out",
      },
    },
  },
  plugins: [],
};

export default config;
```

## Color usage patterns observed in components
- Win state: `border-green-500/35 bg-green-500/10 text-green-300` (or plain `text-green-300` for compact W/L numbers)
- Loss state: `border-red-500/35 bg-red-500/10 text-red-300` (or plain `text-red-300`)
- Unknown/neutral state: `border-bungie-border/70 bg-bungie-dark/50 text-gray-400`
- Body text: `text-gray-100` / `text-gray-300` / `text-gray-400` / `text-gray-500` / `text-gray-600` (descending emphasis)
- Borders at reduced opacity for nested/inner dividers: `border-bungie-border/35`, `/55`, `/60`, `/70`, `/80`
- Exotic gold accent (existing, rare): `#c7a64a`; Legendary purple accent (existing, rare): `#522f65` — not used on landing/dashboard, reserved for item rarity elsewhere in the app family.

## Typography
- No webfonts. `font-sans` = system Helvetica/Segoe stack. `font-mono` = system mono stack, used for all numeric stats (W/L records, K/D, scores).
- Headings/labels are uppercase with wide letter-spacing (`tracking-[0.08em]` to `tracking-[0.22em]`), never mixed-case display type.
- Body copy is small and restrained: `text-sm`/`text-xs`, `leading-relaxed`, muted gray.

## Shape language
- Zero border-radius everywhere (verified: no `rounded-*` classes anywhere in the target files). All corners square.
- No shadows except `shadow-2xl` on the one dropdown/popover overlay (search results list, head-to-head popover) — flat elsewhere.
- 1px hairline borders (`border`, `border-b`, `divide-y`) are the primary structuring device, not shadows or radius.
