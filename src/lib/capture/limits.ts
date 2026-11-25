/**
 * How much text one capture can carry.
 *
 * Shared by the capture textarea, the share-target route and `/api/analyze`'s
 * Zod schema, so the three can never disagree about what fits — the box that
 * silently accepts more than the endpoint takes is a 400 with no explanation.
 */
export const CAPTURE_MAX_CHARS = 4000;
