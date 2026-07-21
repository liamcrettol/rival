export type SignupCapacityResult = {
  status: "available" | "already_registered" | "capacity_reached";
  allowed: boolean;
  already_registered: boolean;
  user_count: number;
  max_users: number;
};

class SignupCapacityVerificationError extends Error {
  constructor(public readonly code: string, public readonly retryable: boolean) {
    super(code);
  }
}

function isValidResult(body: unknown): body is SignupCapacityResult {
  if (!body || typeof body !== "object") return false;
  const value = body as Record<string, unknown>;
  return (
    (value.status === "available" || value.status === "already_registered" || value.status === "capacity_reached") &&
    typeof value.allowed === "boolean" &&
    typeof value.already_registered === "boolean" &&
    typeof value.user_count === "number" &&
    typeof value.max_users === "number"
  );
}

export async function reserveSignupSlot(userId: string): Promise<SignupCapacityResult> {
  const baseUrl = process.env.REROLLED_SYNC_BASE_URL;
  const secret = process.env.REROLLED_SYNC_SECRET;
  if (!baseUrl || !secret) throw new Error("Shared signup capacity is not configured");

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/internal/rival/signup-capacity`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ userId }),
        cache: "no-store",
        signal: AbortSignal.timeout(1_500),
      });
      const body = await response.json().catch(() => null);
      if (response.ok && isValidResult(body)) return body;
      if (response.status === 409 && isValidResult(body) && body.status === "capacity_reached") return body;

      const errorCode = response.status === 404
        ? "capacity_endpoint_unavailable"
        : response.status === 401
          ? "capacity_endpoint_unauthorized"
          : response.status >= 500
            ? "capacity_backend_unavailable"
            : "malformed_capacity_response";
      throw new SignupCapacityVerificationError(errorCode, response.status === 404 || response.status >= 500);
    } catch (error) {
      lastError = error;
      const retryable = error instanceof SignupCapacityVerificationError
        ? error.retryable
        : true;
      if (!retryable || attempt === 1) break;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  const code = lastError instanceof SignupCapacityVerificationError
    ? lastError.code
    : lastError instanceof DOMException && lastError.name === "TimeoutError"
      ? "capacity_request_timeout"
      : "capacity_request_failed";
  throw new Error(`Shared signup capacity verification failed: ${code}`);
}
