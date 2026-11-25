import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { supabaseUrl } from "@/lib/supabase/config";
import { apiError } from "@/lib/api";

/**
 * Storing and removing a browser's push subscription.
 *
 * The values are handed over by the browser and written back verbatim: the
 * keys are used to encrypt the payload at send time, so any normalisation here
 * would produce a subscription that looks fine and silently never delivers.
 *
 * Nothing is trusted about the endpoint beyond its shape. It is a URL the push
 * service issued, the row is owned by `auth.uid()` through RLS, and the unique
 * constraint on `endpoint` is what stops a stale row from a previous sign-in
 * sending this device somebody else's alarms.
 */

/** Browser-reported subscription, as `PushSubscription.toJSON()` returns it. */
const subscriptionSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({
    p256dh: z.string().min(1).max(400),
    auth: z.string().min(1).max(400),
  }),
});

const postSchema = z.object({ subscription: subscriptionSchema }).strict();
const deleteSchema = z.object({ endpoint: z.string().url().max(2000) }).strict();

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError("UNAUTHENTICATED", "Sign in to use MeOS", 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_INPUT", "Request body must be JSON", 400);
  }

  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("INVALID_INPUT", "That doesn't look like a push subscription.", 400);
  }

  const { endpoint, keys } = parsed.data.subscription;

  /*
   * Upsert on endpoint rather than insert: the same browser re-subscribing is
   * the normal case, not an error.
   */
  const row = {
    user_id: user.id,
    endpoint,
    p256dh: keys.p256dh,
    auth: keys.auth,
    user_agent: request.headers.get("user-agent")?.slice(0, 400) ?? null,
    failure_count: 0,
  };
  let { error } = await supabase
    .from("push_subscriptions")
    .upsert(row, { onConflict: "endpoint" });

  /*
   * Taking ownership after an account switch is deliberate — the person
   * signed in now on this browser is the one who should receive its alarms —
   * but RLS correctly refuses to let one user update another's row, so the
   * upsert alone errors forever on a shared device. The proof of ownership is
   * possession: the browser just handed this endpoint over, so the stale row
   * is deleted with the service key (scoped to exactly this endpoint) and the
   * insert retried as the caller.
   */
  if (error) {
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (serviceRoleKey) {
      const admin = createAdminClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      await admin.from("push_subscriptions").delete().eq("endpoint", endpoint);
      ({ error } = await supabase
        .from("push_subscriptions")
        .upsert(row, { onConflict: "endpoint" }));
    }
  }

  if (error) {
    return apiError("INTERNAL_ERROR", "Couldn't save this device for alarms.", 500);
  }

  return NextResponse.json({ ok: true });
}

/** Unsubscribing is a real user action, so it deletes rather than marks. */
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError("UNAUTHENTICATED", "Sign in to use MeOS", 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_INPUT", "Request body must be JSON", 400);
  }

  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("INVALID_INPUT", "Which device should stop receiving alarms?", 400);
  }

  // RLS confines this to the caller's own rows; the filter is what makes it
  // this device rather than all of them.
  const { error } = await supabase
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", parsed.data.endpoint);

  if (error) {
    return apiError("INTERNAL_ERROR", "Couldn't turn alarms off for this device.", 500);
  }

  return NextResponse.json({ ok: true });
}
