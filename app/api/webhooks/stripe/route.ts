import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getStripeClient() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) throw new Error("STRIPE_SECRET_KEY is not configured");
  return new Stripe(secretKey, { apiVersion: "2025-02-24.acacia" });
}

function getSupabaseAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase service credentials are not fully configured");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function mapPriceIdToTier(priceId: string | null | undefined): "starter" | "pro" | "fleet" | null {
  if (!priceId) return null;

  const starterId = process.env.STRIPE_PRICE_STARTER_ID;
  const proId = process.env.STRIPE_PRICE_PRO_ID;
  const fleetId = process.env.STRIPE_PRICE_FLEET_ID;

  if (starterId && priceId === starterId) return "starter";
  if (proId && priceId === proId) return "pro";
  if (fleetId && priceId === fleetId) return "fleet";
  return null;
}

async function handleCheckoutSessionCompleted(
  session: Stripe.Checkout.Session,
): Promise<void> {
  const supabase = getSupabaseAdminClient();
  const stripeCustomerId =
    typeof session.customer === "string" ? session.customer : session.customer?.id;
  const stripeSubscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription?.id ?? null;

  if (!stripeCustomerId) {
    return;
  }

  const companyIdFromMetadata = session.metadata?.company_id ?? null;

  if (companyIdFromMetadata) {
    const { error } = await supabase
      .from("companies")
      .update({
        stripe_customer_id: stripeCustomerId,
        stripe_subscription_id: stripeSubscriptionId,
      })
      .eq("id", companyIdFromMetadata);

    if (error) {
      throw new Error(`Failed to persist checkout session billing IDs: ${error.message}`);
    }

    return;
  }

  const { error } = await supabase
    .from("companies")
    .update({
      stripe_subscription_id: stripeSubscriptionId,
    })
    .eq("stripe_customer_id", stripeCustomerId);

  if (error) {
    throw new Error(`Failed to update company subscription after checkout: ${error.message}`);
  }
}

async function handleSubscriptionUpdated(
  subscription: Stripe.Subscription,
): Promise<void> {
  const supabase = getSupabaseAdminClient();

  const stripeCustomerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer?.id;

  if (!stripeCustomerId) {
    throw new Error("Subscription update missing customer ID");
  }

  const primaryItem = subscription.items.data[0];
  const priceId = primaryItem?.price?.id;
  const tier = mapPriceIdToTier(priceId);

  if (!tier) {
    throw new Error(`Unmapped Stripe price ID: ${priceId ?? "none"}`);
  }

  const { error } = await supabase
    .from("companies")
    .update({
      subscription_tier: tier,
      stripe_customer_id: stripeCustomerId,
      stripe_subscription_id: subscription.id,
    })
    .eq("stripe_customer_id", stripeCustomerId);

  if (error) {
    throw new Error(`Failed to update company subscription tier: ${error.message}`);
  }
}

export async function POST(request: NextRequest) {
  try {
    const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!stripeWebhookSecret) {
      return NextResponse.json(
        { error: "STRIPE_WEBHOOK_SECRET is not configured" },
        { status: 500 },
      );
    }

    const signature = request.headers.get("stripe-signature");
    if (!signature) {
      return NextResponse.json({ error: "Missing stripe-signature header" }, { status: 400 });
    }

    const body = await request.text();
    const stripe = getStripeClient();
    const event = stripe.webhooks.constructEvent(body, signature, stripeWebhookSecret);

    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      case "customer.subscription.updated":
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;
      default:
        break;
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook handling failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

