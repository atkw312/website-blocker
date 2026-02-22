"use client";

const plans = [
  {
    name: "Free",
    price: "$0",
    period: "forever",
    features: [
      "Hide homepage feed",
      "Hide Shorts",
      "Remove sidebar recommendations",
      "Disable autoplay",
      "Session timer",
      "2 sessions per day",
    ],
    cta: "Install Extension",
    ctaHref: process.env.NEXT_PUBLIC_CHROME_EXTENSION_URL || "#",
    highlighted: false,
  },
  {
    name: "Pro",
    price: "$4.99",
    period: "/month",
    features: [
      "Everything in Free",
      "Unlimited sessions",
      "Hard cutoff mode",
      "Scheduled sessions",
      "7-day free trial",
    ],
    cta: "Start Free Trial",
    ctaHref: "/signup",
    highlighted: true,
  },
];

export default function PricingTable() {
  return (
    <div className="mx-auto grid max-w-3xl gap-8 md:grid-cols-2">
      {plans.map((plan) => (
        <div
          key={plan.name}
          className={`rounded-2xl border p-8 ${
            plan.highlighted
              ? "border-paper/30 bg-surface"
              : "border-paper/10 bg-surface"
          }`}
        >
          <h3 className="text-lg font-semibold">{plan.name}</h3>
          <div className="mt-2">
            <span className="text-3xl font-bold">{plan.price}</span>
            <span className="text-sm text-muted"> {plan.period}</span>
          </div>
          <ul className="mt-6 space-y-3">
            {plan.features.map((f) => (
              <li key={f} className="flex items-start gap-2 text-sm text-muted">
                <span className="mt-0.5 text-paper">&#10003;</span>
                {f}
              </li>
            ))}
          </ul>
          <a
            href={plan.ctaHref}
            className={`mt-8 block rounded-lg py-2.5 text-center text-sm font-medium ${
              plan.highlighted
                ? "bg-paper text-ink hover:bg-paper/90"
                : "border border-paper/20 text-paper hover:bg-paper/5"
            }`}
          >
            {plan.cta}
          </a>
        </div>
      ))}
    </div>
  );
}
