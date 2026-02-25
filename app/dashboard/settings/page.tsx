import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { Download, Globe2, CreditCard } from "lucide-react";

export default async function SettingsPage() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return <PanelMessage>Sign in required.</PanelMessage>;
  }

  const admin = getAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("id, role, company_id, is_active")
    .eq("id", user.id)
    .single<{ id: string; role: string; company_id: string; is_active: boolean }>();

  if (!profile?.company_id) {
    return <PanelMessage>No company found for this user.</PanelMessage>;
  }

  const { data: company } = await admin
    .from("companies")
    .select("id, name, timezone, subscription_tier, stripe_customer_id")
    .eq("id", profile.company_id)
    .single<{
      id: string;
      name: string;
      timezone: string;
      subscription_tier: "starter" | "pro" | "fleet";
      stripe_customer_id: string | null;
    }>();

  if (!company) {
    return <PanelMessage>Company settings unavailable.</PanelMessage>;
  }

  const isOwner = profile.role === "owner" && profile.is_active;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Settings</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-slate-900">
          Company Settings & Billing
        </h1>
        <p className="text-sm text-slate-500">{company.name}</p>
      </section>

      <section className="grid gap-6 xl:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-1">
          <div className="mb-4 flex items-center gap-2">
            <Globe2 className="h-4 w-4 text-slate-500" />
            <h2 className="text-base font-semibold text-slate-900">General</h2>
          </div>

          <form
            action={async (formData) => {
              "use server";
              const tz = String(formData.get("timezone") ?? "").trim();
              if (!tz) return;

              const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
              const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
              const adminClient = createClient(supabaseUrl, serviceRoleKey, {
                auth: { persistSession: false, autoRefreshToken: false },
              });

              const cookieStore = await cookies();
              const userClient = createServerClient(
                supabaseUrl,
                process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
                {
                  cookies: {
                    get(name: string) {
                      return cookieStore.get(name)?.value;
                    },
                    set() {},
                    remove() {},
                  },
                },
              );

              const {
                data: { user: actionUser },
              } = await userClient.auth.getUser();
              if (!actionUser) return;

              const { data: actionProfile } = await adminClient
                .from("profiles")
                .select("company_id, role, is_active")
                .eq("id", actionUser.id)
                .single<{ company_id: string; role: string; is_active: boolean }>();

              if (!actionProfile || !actionProfile.is_active || actionProfile.role !== "owner") return;

              await adminClient
                .from("companies")
                .update({ timezone: tz })
                .eq("id", actionProfile.company_id);
            }}
            className="space-y-3"
          >
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-slate-700">Timezone</span>
              <select
                name="timezone"
                defaultValue={company.timezone || "Europe/London"}
                disabled={!isOwner}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-slate-900 focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-100"
              >
                {[
                  "Europe/London",
                  "Europe/Dublin",
                  "Europe/Paris",
                  "UTC",
                  "America/New_York",
                  "America/Chicago",
                  "America/Los_Angeles",
                ].map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              disabled={!isOwner}
              className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              Save Timezone
            </button>
          </form>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-1">
          <div className="mb-4 flex items-center gap-2">
            <Download className="h-4 w-4 text-slate-500" />
            <h2 className="text-base font-semibold text-slate-900">Data & Exports</h2>
          </div>
          <p className="mb-4 text-sm text-slate-500">
            Export your full fleet inventory with assignments, site locations, and service data.
          </p>
          <a
            href="/api/export/inventory"
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Download className="h-4 w-4" />
            Download Fleet CSV
          </a>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-1">
          <div className="mb-4 flex items-center gap-2">
            <CreditCard className="h-4 w-4 text-slate-500" />
            <h2 className="text-base font-semibold text-slate-900">Billing</h2>
          </div>

          <div className="space-y-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
              <p className="text-xs uppercase tracking-[0.12em] text-slate-500">Current Plan</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">
                {company.subscription_tier.charAt(0).toUpperCase() + company.subscription_tier.slice(1)}
              </p>
            </div>
            <form
              action={async () => {
                "use server";
                const portalUrl = process.env.STRIPE_CUSTOMER_PORTAL_URL ?? process.env.NEXT_PUBLIC_STRIPE_CUSTOMER_PORTAL_URL;
                if (!portalUrl) return;
                redirect(portalUrl);
              }}
            >
              <button
                type="submit"
                className="w-full rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500"
              >
                Manage Billing
              </button>
            </form>
            <p className="text-xs text-slate-500">
              Connect a Stripe Customer Portal session URL generator for per-company billing management.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

function PanelMessage({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
      {children}
    </div>
  );
}

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

async function getSupabaseServerClient() {
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
