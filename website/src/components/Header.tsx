import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function Header() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <header className="border-b border-paper/10">
      <div className="mx-auto grid max-w-5xl grid-cols-3 items-center px-6 py-4">
        <Link href="/" className="text-lg font-semibold text-paper">
          Sumi
        </Link>
        <nav className="flex items-center justify-center gap-6 text-sm">
          <Link href="/#features" className="text-muted hover:text-paper">
            Features
          </Link>
          <Link href="/#mission" className="text-muted hover:text-paper">
            Mission
          </Link>
          <Link href="/pricing" className="text-muted hover:text-paper">
            Pricing
          </Link>
        </nav>
        <div className="flex items-center justify-end gap-3 text-sm">
          {user ? (
            <Link
              href="/dashboard"
              className="rounded-lg border border-paper/20 px-4 py-2 text-paper hover:bg-paper/5"
            >
              Dashboard
            </Link>
          ) : (
            <>
              <Link href="/login" className="text-muted hover:text-paper">
                Sign In
              </Link>
              <Link
                href="/signup"
                className="rounded-lg border border-paper/20 px-4 py-2 text-paper hover:bg-paper/5"
              >
                Get Started
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
