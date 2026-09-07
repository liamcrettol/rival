export const UNEXPECTED_ERROR_MESSAGE = "Something went wrong. Please try again.";

// A caught error's message is only safe to hand back to the client when the
// route itself chose the status code for it (e.g. mapping "Unauthorized" to
// 401) - that string was deliberately written as user-facing. A 500 means
// the error was NOT recognized/mapped, so it's whatever the underlying
// failure happened to say (a raw Supabase/Postgres error, etc.) and must not
// reach the client (#31).
export function toClientErrorMessage(message: string, status: number): string {
  return status === 500 ? UNEXPECTED_ERROR_MESSAGE : message;
}
