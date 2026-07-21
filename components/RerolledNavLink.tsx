import { ArrowUpRight } from "lucide-react";

export default function RerolledNavLink() {
  return (
    <a
      href="https://rerolled.io"
      className="inline-flex shrink-0 items-center gap-1.5 border border-bungie-border px-2.5 py-1.5 text-xs font-bold uppercase tracking-widest text-gray-300 transition hover:border-bungie-blue hover:bg-bungie-blue/10"
    >
      <ArrowUpRight size={13} className="text-bungie-blue" />
      <span>View</span>
      <span>
        <span className="text-[#1d4ed8]">Re</span>
        <span className="text-white">rolled</span>
      </span>
    </a>
  );
}
