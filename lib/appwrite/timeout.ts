// Shared timeout helper for node-appwrite SDK calls. The SDK exposes no
// AbortSignal hook to cancel an in-flight request (checked node-appwrite
// v27's Client#call - no signal/AbortController support anywhere), so this
// can only stop *waiting* on a hung call, not cancel the request itself.
// Same non-cancellation caveat lib/supabase's withSupabaseTimeout carries
// (#23) - a timed-out attempt may still complete server-side after the
// caller has already moved on to a retry or a degrade-to-cache path.
export function raceTimeout<T>(
  promise: Promise<T>,
  ms: number,
  opName: string,
  makeError: (message: string) => Error = (message) => new Error(message)
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(makeError(`${opName} timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}
