export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/** Values shipped in .env.example — present but not real credentials. */
const PLACEHOLDERS = ["your-project-ref", "your-anon-key", "your-service-role-key"];

function looksLikePlaceholder(value: string): boolean {
  return PLACEHOLDERS.some((placeholder) => value.includes(placeholder));
}

/**
 * True when the app has real Supabase credentials.
 *
 * Checks more than "non-empty": copying .env.example without editing it leaves
 * placeholder values that would otherwise pass and then fail as opaque network
 * errors deep in a page render. Better to show the setup screen.
 */
export function isSupabaseConfigured(): boolean {
  if (!supabaseUrl || !supabaseAnonKey) return false;
  if (looksLikePlaceholder(supabaseUrl) || looksLikePlaceholder(supabaseAnonKey)) return false;
  try {
    const { protocol, hostname } = new URL(supabaseUrl);
    if (!hostname) return false;
    // `supabase start` serves the local stack over plain HTTP on loopback.
    const isLoopback = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
    return protocol === "https:" || (protocol === "http:" && isLoopback);
  } catch {
    return false;
  }
}
