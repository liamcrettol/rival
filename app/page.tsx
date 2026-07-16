import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import SignInButton from "@/components/SignInButton";
import BrandMark from "@/components/BrandMark";

// Signed-out landing. Signed-in users go straight to their match history.
export default async function Home() {
  const session = await auth();
  if (session?.userId) redirect("/dashboard");

  return (
    <main className="flex min-h-screen flex-col items-center p-8">
      <section className="flex w-full flex-1 flex-col items-center justify-center gap-8">
        <div className="text-center space-y-4">
          <p className="section-label text-bungie-blue">Destiny 2</p>
          <div className="flex items-center justify-center gap-3">
            <BrandMark className="h-11 w-11 md:h-12 md:w-12" />
            <h1 className="text-5xl font-bold uppercase tracking-[0.08em] md:text-6xl">Rival</h1>
          </div>
          <p className="mx-auto max-w-md text-sm leading-relaxed text-gray-400">
            Crucible match history and head-to-head records. Sign in and see
            your record against every player you have ever faced: Trials,
            Competitive, Control, Iron Banner, all of it.
          </p>
        </div>

        <div className="w-full max-w-sm">
          <SignInButton />
        </div>
      </section>

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
    </main>
  );
}
