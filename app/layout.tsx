import type { Metadata } from "next";
import { Archivo, IBM_Plex_Mono } from "next/font/google";

import "./globals.css";
import Providers from "@/components/Providers";

// Archivo (variable width) + IBM Plex Mono, shared with Rerolled.
const archivo = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-archivo", display: "swap" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex-mono", display: "swap" });

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
    <html lang="en" className={`${archivo.variable} ${plexMono.variable}`}>
      <body className="min-h-screen bg-bungie-dark text-gray-100 antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
