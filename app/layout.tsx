import type { Metadata } from "next";
import localFont from "next/font/local";

import "./globals.css";
import Providers from "@/components/Providers";

const archivo = localFont({src: [{path: "./fonts/archivo-400.ttf", weight: "400"}, {path: "./fonts/archivo-500.ttf", weight: "500"}, {path: "./fonts/archivo-600.ttf", weight: "600"}], variable: "--font-archivo", display: "swap"});
const themeScript = `(function(){var s;try{s=localStorage.getItem('mida-theme')}catch(e){}document.documentElement.dataset.theme=s==='light'||s==='dark'?s:matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'})()`;

const DESCRIPTION =
  "Destiny 2 Crucible match history and head-to-head records. See how many times you have beaten the player across the map.";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXTAUTH_URL ?? "https://rival.mida.tools"),
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
    <html lang="en" className={archivo.variable} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body className="min-h-screen bg-bungie-dark text-gray-100 antialiased">
        <a className="mida-skip" href="#mida-content">Skip to content</a><div id="mida-content"><Providers>{children}</Providers></div>
      </body>
    </html>
  );
}
