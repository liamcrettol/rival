import type { SupabaseClient } from "@supabase/supabase-js";
import { getBungieToken } from "@/lib/auth/helpers";
import { bungieGet } from "@/lib/bungie/client";

interface BungieFriend {
  lastSeenAsMembershipId?: string;
}

const FRIEND_SYNC_TTL_MS = 15 * 60 * 1000;
const syncedUntil = new Map<string, number>();

export function extractFriendMembershipIds(
  friends: BungieFriend[],
  viewerMembershipId: string
): string[] {
  return [...new Set(
    friends
      .map((friend) => String(friend.lastSeenAsMembershipId ?? ""))
      .filter((membershipId) => /^\d{1,30}$/.test(membershipId) && membershipId !== viewerMembershipId)
  )];
}

/**
 * Persist both directions so either friend is hidden from the other's rivalry
 * rankings. The encounter history itself remains untouched and searchable.
 */
export async function syncRivalryFriendExclusions(input: {
  userId: string;
  viewerMembershipId: string;
  db: SupabaseClient;
}): Promise<number> {
  const cacheKey = `${input.userId}:${input.viewerMembershipId}`;
  if ((syncedUntil.get(cacheKey) ?? 0) > Date.now()) return 0;

  const accessToken = await getBungieToken(input.userId, input.viewerMembershipId);
  const response = await bungieGet<{ friends?: BungieFriend[] }>("/Social/Friends/", accessToken);
  const friendIds = extractFriendMembershipIds(response.friends ?? [], input.viewerMembershipId);

  if (friendIds.length > 0) {
    const confirmedAt = new Date().toISOString();
    const rows = friendIds.flatMap((friendMembershipId) => [
      {
        viewer_membership_id: input.viewerMembershipId,
        excluded_membership_id: friendMembershipId,
        source: "bungie_friend",
        confirmed_at: confirmedAt,
      },
      {
        viewer_membership_id: friendMembershipId,
        excluded_membership_id: input.viewerMembershipId,
        source: "bungie_friend",
        confirmed_at: confirmedAt,
      },
    ]);
    const { error } = await input.db
      .from("rivalry_exclusions")
      .upsert(rows, { onConflict: "viewer_membership_id,excluded_membership_id" });
    if (error) throw new Error(`Friend exclusion sync failed: ${error.message}`);
  }

  syncedUntil.set(cacheKey, Date.now() + FRIEND_SYNC_TTL_MS);
  return friendIds.length;
}
