export interface CanonicalPlayerIdentity {
  membership_id: string;
  membership_type: number | null;
  display_name: string;
  emblem_path: string | null;
}

// A discriminator makes "Guardian#0042" a legitimate Bungie Global Name;
// only the bare import placeholders should be replaced.
export function isPlaceholderPlayerName(name: string | null | undefined): boolean {
  const normalized = name?.trim().toLocaleLowerCase();
  return normalized === "guardian" || normalized === "destiny" || !normalized;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadCanonicalPlayerIdentities(db: any, membershipIds: string[]) {
  const ids = [...new Set(membershipIds.filter((id) => /^\d{1,30}$/.test(id)))];
  if (ids.length === 0) return new Map<string, CanonicalPlayerIdentity>();
  const { data, error } = await db.rpc("get_latest_player_identities", {
    p_membership_ids: ids,
  });
  if (error) throw new Error(`Player identity lookup failed: ${error.message}`);
  return new Map<string, CanonicalPlayerIdentity>(
    (data ?? []).map((row: CanonicalPlayerIdentity) => [row.membership_id, row] as const),
  );
}
