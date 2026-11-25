import { createHash, timingSafeEqual } from "node:crypto";

/**
 * The sender endpoint authenticates the *scheduler*, not a user: there is no
 * session on a cron request. A single shared secret in the Authorization
 * header is enough, because the only thing the endpoint can be made to do is
 * deliver alarms that are already due to devices their owner registered.
 *
 * Both sides are hashed before comparing: `timingSafeEqual` demands equal
 * lengths, and hashing gets that without leaking how long the real secret is
 * through an early return.
 */
export function authorizedByCronSecret(
  authorizationHeader: string | null,
  secret: string | undefined,
): boolean {
  if (!secret) return false;
  if (!authorizationHeader?.startsWith("Bearer ")) return false;
  const presented = authorizationHeader.slice("Bearer ".length);
  return timingSafeEqual(
    createHash("sha256").update(presented).digest(),
    createHash("sha256").update(secret).digest(),
  );
}
