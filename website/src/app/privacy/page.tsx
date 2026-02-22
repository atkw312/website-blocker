export default function PrivacyPage() {
  return (
    <section className="px-6 py-24">
      <div className="mx-auto max-w-2xl">
        <h1 className="text-3xl font-bold">Privacy Policy</h1>
        <p className="mt-2 text-sm text-muted">Last updated: February 21, 2026</p>

        <div className="mt-10 space-y-8 text-sm leading-relaxed text-muted">
          <div>
            <h2 className="text-base font-semibold text-paper">Overview</h2>
            <p className="mt-2">
              Sumi is a browser extension that helps you watch YouTube
              intentionally by hiding algorithmic content like the homepage feed,
              Shorts, and sidebar recommendations. Your privacy is important to
              us, and Sumi is designed to work with minimal data.
            </p>
          </div>

          <div>
            <h2 className="text-base font-semibold text-paper">Data We Store</h2>
            <p className="mt-2">
              All extension data is stored locally on your device using
              Chrome&apos;s built-in storage API. This includes your session
              preferences (duration, daily session count) and session state
              (timer, pause status). This data never leaves your browser.
            </p>
          </div>

          <div>
            <h2 className="text-base font-semibold text-paper">Data We Collect</h2>
            <p className="mt-2">
              Sumi does not collect, transmit, or sell any personal data. We do
              not track your browsing history, watch history, or any other
              activity. No analytics or telemetry is sent from the extension.
            </p>
          </div>

          <div>
            <h2 className="text-base font-semibold text-paper">Account Data</h2>
            <p className="mt-2">
              If you create a Sumi account for Pro features, we store your email
              address and subscription status via Supabase (our authentication
              and database provider). Payment processing is handled by Stripe.
              We do not store your payment details.
            </p>
          </div>

          <div>
            <h2 className="text-base font-semibold text-paper">Permissions</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>
                <strong className="text-paper">storage</strong> — saves your
                preferences and session state locally
              </li>
              <li>
                <strong className="text-paper">activeTab</strong> — interacts
                with the current YouTube tab to apply the content shield
              </li>
              <li>
                <strong className="text-paper">alarms</strong> — powers the
                session countdown timer
              </li>
              <li>
                <strong className="text-paper">scripting</strong> — injects
                content scripts on YouTube to hide algorithmic content
              </li>
              <li>
                <strong className="text-paper">host permission (youtube.com)</strong>{" "}
                — required to modify the YouTube UI and hide feed, Shorts, and
                recommendations
              </li>
            </ul>
          </div>

          <div>
            <h2 className="text-base font-semibold text-paper">Changes</h2>
            <p className="mt-2">
              We may update this policy from time to time. Any changes will be
              reflected on this page with an updated date.
            </p>
          </div>

          <div>
            <h2 className="text-base font-semibold text-paper">Contact</h2>
            <p className="mt-2">
              If you have questions about this policy, reach out at{" "}
              <a
                href="mailto:support@trysumi.com"
                className="text-paper underline"
              >
                support@trysumi.com
              </a>
              .
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
