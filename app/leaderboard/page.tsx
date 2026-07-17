import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import BrandMark from "@/components/BrandMark";
import SignOutButton from "@/components/SignOutButton";
import TrialsLeaderboard from "@/components/crucible/TrialsLeaderboard";

export const dynamic = "force-dynamic";

export default async function LeaderboardPage() {
  const session = await auth();
  if (!session?.userId) redirect("/");

  return (
    <div className="min-h-screen bg-bungie-dark">
      <header className="border-b border-bungie-border">
        <div className="mx-auto flex h-[4.5rem] max-w-7xl items-center gap-6 px-4 sm:px-6">
          <a href="/dashboard" className="flex items-center gap-2.5">
            <BrandMark className="h-7 w-7" />
            <span className="text-xl font-bold uppercase tracking-[0.12em]">Rival</span>
          </a>
          <a
            href="https://rerolled.io"
            className="text-xs font-bold uppercase tracking-widest text-gray-400 transition-colors hover:text-white"
          >
            Play <span className="text-[#1d4ed8]">Re</span>rolled
          </a>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-sm font-semibold text-gray-300 sm:block">
              {session.displayName}
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        <div className="mb-6">
          <p className="section-label text-bungie-blue">Trials leaderboard</p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
            Your record against the best Trials players you have faced
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-gray-400">
            Ranked by each opponent&apos;s lifetime Trials of Osiris K/D, pulled directly from Bungie.
          </p>
        </div>
        <TrialsLeaderboard />
      </main>
    </div>
  );
}
