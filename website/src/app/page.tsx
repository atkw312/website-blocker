import Link from "next/link";
import PricingTable from "@/components/PricingTable";

const steps = [
  {
    num: "1",
    title: "Install the extension",
    desc: "Add Sumi to Chrome in one click.",
  },
  {
    num: "2",
    title: "Set your session",
    desc: "Choose 15, 25, or 30 minutes of focused watching.",
  },
  {
    num: "3",
    title: "Watch intentionally",
    desc: "The feed, Shorts, and sidebar are hidden. Search for what you want.",
  },
];

export default function Home() {
  const extensionUrl =
    process.env.NEXT_PUBLIC_CHROME_EXTENSION_URL || "#";

  return (
    <>
      {/* Hero */}
      <section className="px-6 pb-8 pt-28 text-center">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-5xl font-bold leading-tight tracking-tight sm:text-6xl">
            Return to Control.
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-lg text-muted">
            Sumi clears away the noise. Hiding your YouTube feed, Shorts, and
            recommendations so you only watch what you came for.
          </p>
          <div className="mt-8 flex items-center justify-center gap-4">
            <a
              href={extensionUrl}
              className="rounded-lg bg-paper px-6 py-3 text-sm font-medium text-ink hover:bg-paper/90"
            >
              Start For Free
            </a>
            <Link
              href="/pricing"
              className="rounded-lg border border-paper/20 px-6 py-3 text-sm font-medium text-paper hover:bg-paper/5"
            >
              See Pro Features
            </Link>
          </div>
        </div>

        {/* Demo */}
        <div className="mx-auto mt-16 max-w-5xl">
          <div className="overflow-hidden rounded-xl border border-paper/10 bg-surface shadow-2xl shadow-black/50">
            <div className="flex items-center gap-2 border-b border-paper/10 px-4 py-3">
              <div className="h-3 w-3 rounded-full bg-paper/15" />
              <div className="h-3 w-3 rounded-full bg-paper/15" />
              <div className="h-3 w-3 rounded-full bg-paper/15" />
            </div>
            <video
              src="/demo.mp4"
              autoPlay
              muted
              loop
              playsInline
              className="w-full"
            />
          </div>
        </div>
      </section>

      {/* Social proof */}
      <section className="px-6 py-10">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-center gap-x-2 gap-y-2">
          <span className="text-sm text-muted">Trusted by students from</span>
          {["University of Toronto", "Carnegie Mellon", "UC Berkeley", "University of Washington"].map((name) => (
            <span key={name} className="text-sm font-medium text-paper/70">
              {name} &middot;
            </span>
          ))}
        </div>
      </section>

      {/* Mission */}
      <section id="mission" className="border-t border-paper/10 px-6 py-24">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-3xl font-semibold">
            YouTube is designed to keep you scrolling
          </h2>
          <p className="mt-4 max-w-xl text-muted leading-relaxed">
            The homepage feed, Shorts, autoplay, and sidebar recommendations are
            algorithm traps. They turn a quick video into an hour of mindless
            watching. Sumi removes them so you stay in control.
          </p>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="border-t border-paper/10 px-6 py-24">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-3xl font-semibold">How it works</h2>
          <div className="mt-12 grid gap-8 md:grid-cols-3">
            {steps.map((s) => (
              <div key={s.num} className="rounded-xl bg-surface p-6">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-paper/10 text-xs font-bold text-paper">
                  {s.num}
                </div>
                <h3 className="mt-4 font-medium">{s.title}</h3>
                <p className="mt-2 text-sm text-muted">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section
        id="pricing"
        className="border-t border-paper/10 px-6 py-24"
      >
        <div className="mx-auto max-w-5xl">
          <h2 className="text-3xl font-semibold">Pricing</h2>
          <p className="mt-3 text-muted">
            Start free. Upgrade when you need more.
          </p>
        </div>
        <div className="mt-12">
          <PricingTable />
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-paper/10 px-6 py-24">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-3xl font-semibold">
            Return to Control.
          </h2>
          <p className="mt-3 text-muted">
            Install the free extension and start watching intentionally today.
          </p>
          <a
            href={extensionUrl}
            className="mt-6 inline-flex items-center gap-2 rounded-lg border border-paper/20 px-6 py-3 text-sm font-medium text-paper hover:bg-paper/5"
          >
            Start For Free
          </a>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-paper/10 px-6 py-8">
        <div className="mx-auto flex max-w-5xl items-center justify-between text-xs text-muted">
          <span>&copy; {new Date().getFullYear()} Sumi</span>
          <div className="flex gap-6">
            <Link href="/pricing" className="hover:text-paper">Pricing</Link>
            <Link href="/privacy" className="hover:text-paper">Privacy</Link>
            <Link href="/login" className="hover:text-paper">Sign In</Link>
          </div>
        </div>
      </footer>
    </>
  );
}
