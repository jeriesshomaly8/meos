import { NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { apiError } from "@/lib/api";
import { supabaseUrl } from "@/lib/supabase/config";

/**
 * Delete-account flow. Removing the auth user cascades to every data table
 * via ON DELETE CASCADE. Requires the service-role key server-side; the key
 * never reaches the client.
 */
export async function DELETE() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return apiError("UNAUTHENTICATED", "Sign in first", 401);
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    return apiError(
      "NOT_CONFIGURED",
      "Account deletion isn't configured on this server (missing service key). You can still use \"Delete all my data\" and stop using the app, or contact the operator.",
      503,
    );
  }

  const admin = createAdminClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) {
    console.error("[account] delete failed:", error.message);
    return apiError("INTERNAL_ERROR", "Couldn't delete your account. Please try again.", 500);
  }

  await supabase.auth.signOut();
  return NextResponse.json({ deleted: true });
}
