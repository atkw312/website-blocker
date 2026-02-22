import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";

/**
 * Extract the authenticated user from a request.
 * Supports both cookie auth (dashboard) and Bearer token auth (extension).
 */
export async function getAuthUser(request: Request) {
  const authHeader = request.headers.get("authorization");

  // Bearer token (extension calls)
  if (authHeader?.startsWith("Bearer ")) {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user ? { user, supabase } : null;
  }

  // Cookie auth (dashboard)
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? { user, supabase } : null;
}
