import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import MidaHeader from "@/components/MidaHeader";
import SignOutButton from "@/components/SignOutButton";
import MatchHallOfFame from "@/components/crucible/MatchHallOfFame";

export const dynamic = "force-dynamic";

export default async function LeaderboardPage() {
  const session = await auth();
  if (!session?.userId) redirect("/");

  return (
    <div className="min-h-screen bg-bungie-dark">
      <MidaHeader tool="rival" href="/dashboard"><span className="hidden sm:inline">{session.displayName}</span><SignOutButton /></MidaHeader>

      <main className="mida-wrap pt-16 md:pt-24">
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
            Match hall of fame
          </h1>
        </div>
        <MatchHallOfFame />
      </main>
    </div>
  );
}
