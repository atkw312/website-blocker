import PricingTable from "@/components/PricingTable";

export default function PricingPage() {
  return (
    <section className="px-6 py-24">
      <div className="mx-auto max-w-5xl">
        <h1 className="text-3xl font-bold">Simple pricing</h1>
        <p className="mt-3 text-muted">
          Start free. Upgrade when you need unlimited sessions and scheduling.
        </p>
      </div>
      <div className="mt-12">
        <PricingTable />
      </div>
    </section>
  );
}
