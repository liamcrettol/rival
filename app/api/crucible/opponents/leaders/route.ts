import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/helpers";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import type { RivalryLeader } from "@/lib/crucible/types";
import { syncRivalryFriendExclusions } from "@/lib/crucible/rivalryFriends";

interface LeaderRow {
  leader_type: "wins" | "losses";
  rank: number | string;
  opponent_membership_id: string;
  opponent_membership_type: number | null;
  opponent_display_name: string;
  encounters: number | string;
  wins: number | string;
  losses: number | string;
  unknown: number | string;
  last_played_at: string;
}

export async function GET() {
  try {
    const session = await requireSession();
    // This aggregate can exceed the app-wide 1.2s Supabase budget for users
    // with large histories, so give this authenticated dashboard query room.
    const supabase = createAdminSupabaseClient(5_000);
    await syncRivalryFriendExclusions({
      userId: session.userId,
      viewerMembershipId: session.bungieMembershipId,
      db: supabase,
    }).catch((error) => {
      // Last-known exclusions remain in Postgres when Bungie is unavailable.
      console.error(
        "[crucible/rivalry-leaders] friend sync failed:",
        error instanceof Error ? error.message : error
      );
    });
    const { data, error } = await supabase.rpc("get_h2h_rivalry_leaders", {
      p_viewer_user_id: session.userId,
      p_limit: 5,
    });
    if (error) throw new Error(`Rivalry leaderboard lookup failed: ${error.message}`);
    const rows = (data ?? []) as LeaderRow[];
    const membershipIds = [...new Set(rows.map((row) => row.opponent_membership_id))];
    const { data: emblemRows, error: emblemError } = membershipIds.length > 0
      ? await supabase.rpc("get_latest_player_emblems", { p_membership_ids: membershipIds })
      : { data: [], error: null };
    if (emblemError) throw new Error(`Rivalry emblem lookup failed: ${emblemError.message}`);
    const emblems = new Map<string, string>(
      (emblemRows ?? []).map((row: { membership_id: string; emblem_path: string }) => [row.membership_id, row.emblem_path] as const),
    );
    const convert = (row: LeaderRow): RivalryLeader => ({
      rank: Number(row.rank),
      membershipId: row.opponent_membership_id,
      membershipType: row.opponent_membership_type,
      displayName: row.opponent_display_name,
      emblemPath: emblems.get(row.opponent_membership_id) ?? null,
      encounters: Number(row.encounters),
      wins: Number(row.wins),
      losses: Number(row.losses),
      unknown: Number(row.unknown),
      lastPlayedAt: row.last_played_at,
    });
    return NextResponse.json({
      mostDefeated: rows.filter((row) => row.leader_type === "wins").map(convert),
      toughestRivals: rows.filter((row) => row.leader_type === "losses").map(convert),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load rivalry leaders";
    return NextResponse.json({ error: message }, { status: message === "Unauthorized" ? 401 : 500 });
  }
}
