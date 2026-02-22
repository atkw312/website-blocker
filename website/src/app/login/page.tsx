"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"password" | "magic">("password");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage("");

    const supabase = createClient();

    if (mode === "magic") {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${location.origin}/auth/callback` },
      });
      setLoading(false);
      if (error) {
        setMessage(error.message);
      } else {
        setMessage("Check your email for the login link.");
      }
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    setLoading(false);
    if (error) {
      setMessage(error.message);
    } else {
      router.push("/dashboard");
    }
  }

  return (
    <section className="flex min-h-[70vh] items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold">Sign in</h1>
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-muted">
              Email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-paper/20 bg-surface px-3 py-2 text-sm text-paper focus:border-paper/50 focus:outline-none focus:ring-1 focus:ring-paper/50"
            />
          </div>
          {mode === "password" && (
            <div>
              <label className="block text-sm font-medium text-muted">
                Password
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-paper/20 bg-surface px-3 py-2 text-sm text-paper focus:border-paper/50 focus:outline-none focus:ring-1 focus:ring-paper/50"
              />
            </div>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-paper py-2.5 text-sm font-medium text-ink hover:bg-paper/90 disabled:opacity-50"
          >
            {loading
              ? "..."
              : mode === "magic"
                ? "Send Magic Link"
                : "Sign In"}
          </button>
        </form>
        <button
          onClick={() => setMode(mode === "password" ? "magic" : "password")}
          className="mt-4 block w-full text-center text-sm text-muted hover:text-paper"
        >
          {mode === "password"
            ? "Sign in with magic link instead"
            : "Sign in with password instead"}
        </button>
        {message && (
          <p className="mt-4 text-center text-sm text-muted">{message}</p>
        )}
        <p className="mt-6 text-center text-sm text-muted">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="text-paper underline">
            Sign up
          </Link>
        </p>
      </div>
    </section>
  );
}
