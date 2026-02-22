import { getAuthUser } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const auth = await getAuthUser(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: sub } = await auth.supabase
    .from("subscriptions")
    .select("plan, trial_end, current_period_end, cancel_at_period_end")
    .eq("user_id", auth.user.id)
    .single();

  const plan = sub?.plan ?? "free";
  const isProUser = plan === "pro" || plan === "trial";

  return NextResponse.json({
    plan,
    isProUser,
    trialEnd: sub?.trial_end ?? null,
    currentPeriodEnd: sub?.current_period_end ?? null,
    cancelAtPeriodEnd: sub?.cancel_at_period_end ?? false,
  });
}
