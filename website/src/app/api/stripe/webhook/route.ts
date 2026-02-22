import { getStripe } from "@/lib/stripe";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(request: Request) {
  const stripe = getStripe();
  const supabaseAdmin = getSupabaseAdmin();
  const body = await request.text();
  const sig = request.headers.get("stripe-signature")!;

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      const userId = session.metadata?.user_id;
      const subscriptionId = session.subscription as string;

      if (userId && subscriptionId) {
        const subscription =
          await stripe.subscriptions.retrieve(subscriptionId);

        await supabaseAdmin
          .from("subscriptions")
          .update({
            stripe_subscription_id: subscriptionId,
            stripe_customer_id: session.customer as string,
            plan: subscription.status === "trialing" ? "trial" : "pro",
            trial_end: subscription.trial_end
              ? new Date(subscription.trial_end * 1000).toISOString()
              : null,
            current_period_end: new Date(
              subscription.current_period_end * 1000
            ).toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", userId);
      }
      break;
    }

    case "customer.subscription.updated": {
      const subscription = event.data.object;
      const { data } = await supabaseAdmin
        .from("subscriptions")
        .select("user_id")
        .eq("stripe_subscription_id", subscription.id)
        .single();

      if (data) {
        let plan: string;
        if (subscription.status === "trialing") plan = "trial";
        else if (subscription.status === "active") plan = "pro";
        else plan = "free";

        await supabaseAdmin
          .from("subscriptions")
          .update({
            plan,
            trial_end: subscription.trial_end
              ? new Date(subscription.trial_end * 1000).toISOString()
              : null,
            current_period_end: new Date(
              subscription.current_period_end * 1000
            ).toISOString(),
            cancel_at_period_end: subscription.cancel_at_period_end,
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", data.user_id);
      }
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object;
      await supabaseAdmin
        .from("subscriptions")
        .update({
          plan: "free",
          trial_end: null,
          current_period_end: null,
          cancel_at_period_end: false,
          updated_at: new Date().toISOString(),
        })
        .eq("stripe_subscription_id", subscription.id);
      break;
    }
  }

  return NextResponse.json({ received: true });
}
