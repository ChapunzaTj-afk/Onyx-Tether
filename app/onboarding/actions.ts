"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

export type OnboardingState = {
  error?: string;
};

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase service credentials are not configured");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function getUserClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Supabase public credentials are not configured");
  }

  const cookieStore = await cookies();

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        cookieStore.set({ name, value, ...options });
      },
      remove(name: string, options: CookieOptions) {
        cookieStore.set({ name, value: "", ...options, maxAge: 0 });
      },
    },
  });
}

export async function completeOwnerOnboarding(
  _prevState: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  try {
    const fullName = String(formData.get("full_name") ?? "").trim();
    const phoneNumber = String(formData.get("phone_number") ?? "").trim();
    const businessEmail = String(formData.get("business_email") ?? "").trim().toLowerCase();
    const companyName = String(formData.get("company_name") ?? "").trim();
    const timezone = String(formData.get("timezone") ?? "Europe/London").trim() || "Europe/London";

    if (!fullName || !phoneNumber || !businessEmail || !companyName) {
      return { error: "All onboarding fields are required." };
    }

    const userClient = await getUserClient();
    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();

    if (authError || !user) {
      return { error: "You must be signed in with OTP before completing onboarding." };
    }

    const admin = getAdminClient();

    const { data: company, error: companyError } = await admin
      .from("companies")
      .insert({
        name: companyName,
        timezone,
        subscription_tier: "starter",
      })
      .select("id")
      .single<{ id: string }>();

    if (companyError || !company) {
      return { error: companyError?.message || "Failed to create company." };
    }

    const { error: profileError } = await admin.from("profiles").upsert(
      {
        id: user.id,
        full_name: fullName,
        phone_number: phoneNumber,
        role: "owner",
        company_id: company.id,
        is_active: true,
      },
      { onConflict: "id" },
    );

    if (profileError) {
      return { error: `Company created but profile setup failed: ${profileError.message}` };
    }

    // Profiles does not currently store email, so persist it in Auth + metadata for billing workflows.
    const { error: authUpdateError } = await admin.auth.admin.updateUserById(user.id, {
      email: businessEmail,
      user_metadata: {
        ...(user.user_metadata ?? {}),
        full_name: fullName,
        phone_number: phoneNumber,
        business_email: businessEmail,
        company_id: company.id,
        company_name: companyName,
        role: "owner",
      },
    });

    if (authUpdateError) {
      return { error: `Profile saved but auth profile update failed: ${authUpdateError.message}` };
    }

    const stripeCheckoutUrl = process.env.NEXT_PUBLIC_STRIPE_CHECKOUT_URL;
    if (stripeCheckoutUrl) {
      redirect(stripeCheckoutUrl);
    }

    redirect("/dashboard");
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Onboarding failed. Please try again.",
    };
  }
}

