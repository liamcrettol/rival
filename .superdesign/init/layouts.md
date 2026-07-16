# Layouts

Rival has no shared nav/sidebar component. There is a root layout
(`app/layout.tsx`) that wraps every page in `Providers` (NextAuth session
context only, renders nothing visible), and each top-level page
(`app/page.tsx` for signed-out landing, `app/dashboard/page.tsx` for
signed-in) builds its own header inline — there is no extracted `<Header>`
or `<NavBar>` component to reuse.

## Root layout
- Source: `app/layout.tsx`
- Renders: `<html><body>` shell, sets `bg-bungie-dark text-gray-100
  antialiased` globally, wraps children in `<Providers>`.
```tsx
import type { Metadata } from "next";
import "./globals.css";
import Providers from "@/components/Providers";

const DESCRIPTION =
  "Destiny 2 Crucible match history and head-to-head records. See how many times you have beaten the player across the map.";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXTAUTH_URL ?? "https://rival.rerolled.io"),
  title: {
    default: "Rival",
    template: "%s | Rival",
  },
  description: DESCRIPTION,
  applicationName: "Rival",
  robots: { index: false, follow: false },
  openGraph: {
    type: "website",
    siteName: "Rival",
    title: "Rival",
    description: DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-bungie-dark text-gray-100 antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

## Providers
- Source: `components/Providers.tsx`
- Renders: NextAuth `SessionProvider` only, no visible chrome.
```tsx
"use client";

import { SessionProvider } from "next-auth/react";

export default function Providers({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
```

## Dashboard header (inline in app/dashboard/page.tsx, not extracted)
```tsx
<header className="border-b border-bungie-border">
  <div className="mx-auto flex h-[4.5rem] max-w-5xl items-center gap-6 px-4 sm:px-6">
    <span className="text-xl font-bold uppercase tracking-[0.12em]">Rival</span>
    <a
      href="https://rerolled.io"
      className="text-xs font-bold uppercase tracking-widest text-gray-400 transition-colors hover:text-white"
    >
      Play Rerolled
    </a>
    <div className="ml-auto flex items-center gap-3">
      <span className="hidden text-sm font-semibold text-gray-300 sm:block">
        {session.displayName}
      </span>
      <SignOutButton />
    </div>
  </div>
</header>
```
64px-tall (`h-[4.5rem]` = 72px) bar, 1px bottom border (`border-bungie-border`),
content capped at `max-w-5xl`, horizontally centered. Left: wordmark + "Play
Rerolled" text link. Right (`ml-auto`): display name (hidden below `sm`) +
SignOutButton.

## Footer / bottom row (inline in app/page.tsx only, landing page has no
header — see routes.md)
```tsx
<div className="flex items-center gap-3 pt-8 text-xs text-gray-600">
  <span>Made by Invict Software Solutions</span>
  <span aria-hidden="true">·</span>
  <a href="https://rerolled.io" className="inline-flex min-h-[44px] items-center hover:text-gray-400">
    Play Rerolled
  </a>
  <span aria-hidden="true">·</span>
  <Link href="/privacy" className="inline-flex min-h-[44px] items-center hover:text-gray-400">
    Privacy Policy
  </Link>
</div>
```
