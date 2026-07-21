export type SignupCapacityResult = {
  allowed: boolean;
  already_registered: boolean;
  user_count: number;
};

export async function reserveSignupSlot(userId: string): Promise<SignupCapacityResult> {
  const baseUrl = process.env.REROLLED_SYNC_BASE_URL;
  const secret = process.env.REROLLED_SYNC_SECRET;
  if (!baseUrl || !secret) throw new Error("Shared signup capacity is not configured");

  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/internal/rival/signup-capacity`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ userId }),
    cache: "no-store",
  });
  const body = await response.json().catch(() => null) as SignupCapacityResult & { error?: string } | null;
  if (!response.ok || !body?.allowed) {
    if (response.status === 409) return body as SignupCapacityResult;
    throw new Error(`Shared signup capacity check failed (${response.status}): ${body?.error ?? "unknown error"}`);
  }
  return body;
}
