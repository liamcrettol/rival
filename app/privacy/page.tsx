import Link from "next/link";
import type { Metadata } from "next";

// Root layout applies the "%s | Rival" title template.
export const metadata: Metadata = {
  title: "Privacy Policy",
};

export default function PrivacyPage() {
  return (
    <main className="relative min-h-screen flex justify-center p-8">
      <div className="panel p-8 max-w-2xl w-full h-fit mt-16 text-gray-300 leading-relaxed">
        <h1 className="text-2xl font-bold text-white mb-1">Privacy Policy</h1>
        <p className="text-xs text-gray-500 mb-6">Last updated: July 14, 2026</p>

        <p className="mb-4">
          Rival is a free Destiny 2 Crucible history tool. This policy explains what data
          we collect and why.
        </p>

        <h2 className="text-lg font-semibold text-white mt-6 mb-2">What we collect</h2>
        <ul className="list-disc list-inside space-y-2 mb-4">
          <li>
            <span className="font-medium text-gray-200">Bungie account data.</span> When you
            sign in with Bungie, we store your Bungie membership ID, display name, and an
            encrypted OAuth access/refresh token. We use this to read your Crucible
            activity history from the Bungie API.
          </li>
          <li>
            <span className="font-medium text-gray-200">Match data.</span> Post-game
            carnage reports for your Crucible matches are imported and stored so the app
            can show your match history and your head-to-head record against players you
            have faced. A match report includes the public scoreboard: every player&apos;s
            display name, membership ID, team, and stats for that match.
          </li>
        </ul>

        <h2 className="text-lg font-semibold text-white mt-6 mb-2">How it&apos;s stored</h2>
        <p className="mb-4">
          Data is stored in our Supabase database. OAuth tokens are encrypted at rest
          (AES-256-GCM) and are only decrypted server-side to call the Bungie API on your
          behalf. We never see or store your Bungie password.
        </p>

        <h2 className="text-lg font-semibold text-white mt-6 mb-2">Third parties</h2>
        <p className="mb-4">
          We share data with the{" "}
          <a
            href="https://www.bungie.net/7/en/Legal/PrivacyPolicy"
            target="_blank"
            rel="noopener noreferrer"
            className="text-bungie-blue hover:underline"
          >
            Bungie API
          </a>{" "}
          (to read activity history), Supabase (database hosting), Appwrite (raw match
          report archive), and Vercel (app hosting). We don&apos;t sell your data or share
          it with advertisers.
        </p>

        <h2 className="text-lg font-semibold text-white mt-6 mb-2">Your data</h2>
        <p className="mb-4">
          You can revoke Rival&apos;s access at any time from your{" "}
          <a
            href="https://www.bungie.net/7/en/User/Account/IdentityAuthorizations"
            target="_blank"
            rel="noopener noreferrer"
            className="text-bungie-blue hover:underline"
          >
            Bungie account settings
          </a>
          . To request deletion of your account data from our database, contact us below.
        </p>

        <h2 className="text-lg font-semibold text-white mt-6 mb-2">Contact</h2>
        <p className="mb-2">
          Questions about this policy or your data? Reach out on{" "}
          <a
            href="https://github.com/liamcrettol/rerolled/issues"
            target="_blank"
            rel="noopener noreferrer"
            className="text-bungie-blue hover:underline"
          >
            GitHub
          </a>
          .
        </p>

        <Link href="/" className="inline-block mt-8 text-sm text-gray-500 hover:text-gray-300">
          &larr; Back home
        </Link>
      </div>
    </main>
  );
}
