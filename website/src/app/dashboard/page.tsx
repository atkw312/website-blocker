"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

interface Schedule {
  days: string[];
  startTime: string;
  durationMinutes: number;
}

const DAY_OPTIONS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function DashboardPage() {
  const supabase = createClient();
  const router = useRouter();

  const [plan, setPlan] = useState("free");
  const [trialEnd, setTrialEnd] = useState<string | null>(null);
  const [cancelAtEnd, setCancelAtEnd] = useState(false);

  const [duration, setDuration] = useState(25);
  const [hardCutoff, setHardCutoff] = useState(false);
  const [schedules, setSchedules] = useState<Schedule[]>([]);

  const [sessionsToday, setSessionsToday] = useState(0);
  const [totalSessions, setTotalSessions] = useState(0);
  const [totalMinutes, setTotalMinutes] = useState(0);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const isPro = plan === "pro" || plan === "trial";

  const load = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const [{ data: sub }, { data: settings }, { data: stats }] =
      await Promise.all([
        supabase
          .from("subscriptions")
          .select("*")
          .eq("user_id", user.id)
          .single(),
        supabase
          .from("user_settings")
          .select("*")
          .eq("user_id", user.id)
          .single(),
        supabase
          .from("session_stats")
          .select("*")
          .eq("user_id", user.id)
          .single(),
      ]);

    if (sub) {
      setPlan(sub.plan);
      setTrialEnd(sub.trial_end);
      setCancelAtEnd(sub.cancel_at_period_end);
    }
    if (settings) {
      setDuration(settings.session_duration_minutes);
      setHardCutoff(settings.hard_cutoff);
      setSchedules(settings.schedules || []);
    }
    if (stats) {
      const today = new Date().toISOString().slice(0, 10);
      setSessionsToday(
        stats.last_session_date === today ? stats.sessions_today : 0
      );
      setTotalSessions(stats.total_sessions);
      setTotalMinutes(stats.total_focus_minutes);
    }
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  async function saveSettings() {
    setSaving(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    await supabase
      .from("user_settings")
      .update({
        session_duration_minutes: duration,
        hard_cutoff: isPro ? hardCutoff : false,
        schedules: isPro ? schedules : [],
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", user.id);

    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function handleUpgrade() {
    const res = await fetch("/api/checkout", { method: "POST" });
    const { url } = await res.json();
    if (url) window.location.href = url;
  }

  async function handleManageBilling() {
    const res = await fetch("/api/billing/portal", { method: "POST" });
    const { url } = await res.json();
    if (url) window.location.href = url;
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/");
  }

  function trialDaysLeft() {
    if (!trialEnd) return 0;
    const ms = new Date(trialEnd).getTime() - Date.now();
    return Math.max(0, Math.ceil(ms / 86400000));
  }

  function addSchedule() {
    setSchedules([
      ...schedules,
      { days: ["Mon", "Tue", "Wed", "Thu", "Fri"], startTime: "09:00", durationMinutes: 25 },
    ]);
  }

  function removeSchedule(i: number) {
    setSchedules(schedules.filter((_, idx) => idx !== i));
  }

  function updateSchedule(i: number, patch: Partial<Schedule>) {
    setSchedules(
      schedules.map((s, idx) => (idx === i ? { ...s, ...patch } : s))
    );
  }

  function toggleDay(i: number, day: string) {
    const s = schedules[i];
    const days = s.days.includes(day)
      ? s.days.filter((d) => d !== day)
      : [...s.days, day];
    updateSchedule(i, { days });
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <button
          onClick={handleSignOut}
          className="text-sm text-muted hover:text-paper"
        >
          Sign out
        </button>
      </div>

      {/* Account */}
      <section className="mt-8 rounded-xl border border-paper/10 bg-surface p-6">
        <h2 className="font-semibold">Account</h2>
        <div className="mt-4 flex items-center gap-3">
          <span className="inline-block rounded-full bg-paper/10 px-3 py-1 text-sm font-medium text-paper">
            {plan === "trial"
              ? `Trial (${trialDaysLeft()}d left)`
              : plan.charAt(0).toUpperCase() + plan.slice(1)}
          </span>
          {cancelAtEnd && (
            <span className="text-xs text-muted">Cancels at period end</span>
          )}
        </div>
        <div className="mt-4 flex gap-3">
          {plan === "free" && (
            <button
              onClick={handleUpgrade}
              className="rounded-lg bg-paper px-4 py-2 text-sm font-medium text-ink hover:bg-paper/90"
            >
              Upgrade to Pro
            </button>
          )}
          {(plan === "pro" || plan === "trial") && (
            <button
              onClick={handleManageBilling}
              className="rounded-lg border border-paper/20 px-4 py-2 text-sm text-paper hover:bg-paper/5"
            >
              Manage Billing
            </button>
          )}
        </div>
      </section>

      {/* Control Center */}
      <section className="mt-6 rounded-xl border border-paper/10 bg-surface p-6">
        <h2 className="font-semibold">Control Center</h2>

        {/* Duration */}
        <div className="mt-4">
          <label className="text-sm text-muted">
            Default session duration
          </label>
          <div className="mt-2 flex gap-2">
            {[15, 25, 30].map((m) => (
              <button
                key={m}
                onClick={() => setDuration(m)}
                className={`rounded-lg px-4 py-2 text-sm font-medium ${
                  duration === m
                    ? "bg-paper text-ink"
                    : "border border-paper/20 text-paper hover:bg-paper/5"
                }`}
              >
                {m} min
              </button>
            ))}
          </div>
        </div>

        {/* Hard cutoff */}
        <div className="mt-6 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Hard cutoff</p>
            <p className="text-xs text-muted">
              Block YouTube completely when session ends
            </p>
          </div>
          {isPro ? (
            <button
              onClick={() => setHardCutoff(!hardCutoff)}
              className={`relative h-6 w-11 rounded-full transition-colors ${
                hardCutoff ? "bg-paper" : "bg-paper/20"
              }`}
            >
              <span
                className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full transition-transform ${
                  hardCutoff ? "translate-x-5 bg-ink" : "bg-muted"
                }`}
              />
            </button>
          ) : (
            <span className="text-xs text-muted">Pro only</span>
          )}
        </div>

        {/* Scheduling */}
        <div className="mt-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Scheduled sessions</p>
              <p className="text-xs text-muted">
                Auto-start Sumi on a schedule
              </p>
            </div>
            {!isPro && (
              <span className="text-xs text-muted">Pro only</span>
            )}
          </div>

          {isPro && (
            <div className="mt-3 space-y-3">
              {schedules.map((s, i) => (
                <div
                  key={i}
                  className="rounded-lg border border-paper/10 p-3"
                >
                  <div className="flex flex-wrap gap-1">
                    {DAY_OPTIONS.map((d) => (
                      <button
                        key={d}
                        onClick={() => toggleDay(i, d)}
                        className={`rounded px-2 py-1 text-xs ${
                          s.days.includes(d)
                            ? "bg-paper text-ink"
                            : "bg-paper/5 text-muted"
                        }`}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                  <div className="mt-2 flex items-center gap-3">
                    <input
                      type="time"
                      value={s.startTime}
                      onChange={(e) =>
                        updateSchedule(i, { startTime: e.target.value })
                      }
                      className="rounded border border-paper/20 bg-ink px-2 py-1 text-sm text-paper"
                    />
                    <select
                      value={s.durationMinutes}
                      onChange={(e) =>
                        updateSchedule(i, {
                          durationMinutes: Number(e.target.value),
                        })
                      }
                      className="rounded border border-paper/20 bg-ink px-2 py-1 text-sm text-paper"
                    >
                      <option value={15}>15 min</option>
                      <option value={25}>25 min</option>
                      <option value={30}>30 min</option>
                    </select>
                    <button
                      onClick={() => removeSchedule(i)}
                      className="ml-auto text-xs text-muted hover:text-paper"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
              <button
                onClick={addSchedule}
                className="text-sm text-paper underline"
              >
                + Add schedule
              </button>
            </div>
          )}
        </div>

        {/* Save */}
        <button
          onClick={saveSettings}
          disabled={saving}
          className="mt-6 rounded-lg bg-paper px-5 py-2 text-sm font-medium text-ink hover:bg-paper/90 disabled:opacity-50"
        >
          {saving ? "Saving..." : saved ? "Saved" : "Save Settings"}
        </button>
      </section>

      {/* Stats */}
      <section className="mt-6 rounded-xl border border-paper/10 bg-surface p-6">
        <h2 className="font-semibold">Stats</h2>
        <div className="mt-4 grid grid-cols-3 gap-4 text-center">
          <div>
            <p className="text-2xl font-bold">{sessionsToday}</p>
            <p className="text-xs text-muted">Sessions today</p>
          </div>
          <div>
            <p className="text-2xl font-bold">{totalSessions}</p>
            <p className="text-xs text-muted">Total sessions</p>
          </div>
          <div>
            <p className="text-2xl font-bold">{totalMinutes}</p>
            <p className="text-xs text-muted">Focus minutes</p>
          </div>
        </div>
      </section>
    </div>
  );
}
