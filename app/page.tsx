import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import SignInButton from "@/components/SignInButton";
import MidaHeader from "@/components/MidaHeader";
export default async function Home() {
  const session = await auth();
  if (session?.userId) redirect("/dashboard");
  return <><MidaHeader tool="rival" /><main className="mida-wrap">
    <section className="mida-hero"><h1>Rival</h1><p>Your Crucible history and recorded encounters. See your record against the players you meet again.</p></section>
    <div className="pb-20"><SignInButton /></div>
    <footer className="mida-footer"><a href="https://mida.tools">All applications</a><Link href="/privacy">Privacy policy</Link><span>Fan-made. Destiny and MIDA belong to Bungie.</span></footer>
  </main></>;
}
