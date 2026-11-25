import { NextResponse } from "next/server";

export type ApiErrorCode =
  | "UNAUTHENTICATED"
  | "INVALID_INPUT"
  | "RATE_LIMITED"
  | "NOT_CONFIGURED"
  | "PROVIDER_ERROR"
  | "INTERNAL_ERROR";

/** Uniform error envelope: { error: { code, message } }. Never a 200. */
export function apiError(code: ApiErrorCode, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

interface Bucket {
  count: number;
  resetAt: number;
}

// In-memory, per-server-instance rate limiting. Good enough for the MVP's
// single-instance deployments; swap for a durable store (e.g. Upstash) before
// scaling horizontally. Structure is per-user so one user can never exhaust
// another's quota.
const buckets = new Map<string, Bucket>();

export function checkRateLimit(
  userId: string,
  action: string,
  limit: number,
  windowMs: number,
): { allowed: boolean; retryAfterSeconds: number } {
  const key = `${action}:${userId}`;
  const now = Date.now();

  // The capture endpoint keys buckets by an attacker-suppliable token, so the
  // map must not grow without bound: sweep expired buckets once it gets big.
  if (buckets.size > 1000) {
    for (const [staleKey, stale] of buckets) {
      if (stale.resetAt <= now) buckets.delete(staleKey);
    }
  }

  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (bucket.count >= limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000),
    };
  }

  bucket.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}
