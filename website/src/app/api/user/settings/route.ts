import { getAuthUser } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const auth = await getAuthUser(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data } = await auth.supabase
    .from("user_settings")
    .select("session_duration_minutes, hard_cutoff, schedules")
    .eq("user_id", auth.user.id)
    .single();

  return NextResponse.json(
    data ?? { session_duration_minutes: 25, hard_cutoff: false, schedules: [] }
  );
}

export async function POST(request: Request) {
  const auth = await getAuthUser(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();

  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (typeof body.session_duration_minutes === "number") {
    update.session_duration_minutes = Math.min(
      Math.max(body.session_duration_minutes, 1),
      120
    );
  }
  if (typeof body.hard_cutoff === "boolean") {
    update.hard_cutoff = body.hard_cutoff;
  }
  if (Array.isArray(body.schedules)) {
    update.schedules = body.schedules;
  }

  const { error } = await auth.supabase
    .from("user_settings")
    .update(update)
    .eq("user_id", auth.user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
