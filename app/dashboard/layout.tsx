import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import {
  Blocks,
  HardHat,
  LayoutDashboard,
  Settings,
  Wrench,
  MapPinned,
  ChevronDown,
} from "lucide-react";

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/onboarding");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role, company_id")
    .eq("id", user.id)
    .single<{ full_name: string | null; role: string; company_id: string }>();

  const { data: company } = await supabase
    .from("companies")
    .select("name")
    .eq("id", profile?.company_id ?? "")
    .maybeSingle<{ name: string }>();

  const companyName = company?.name ?? "Onyx Tether Workspace";
  const userName = profile?.full_name?.trim() || "Owner";

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <div className="grid min-h-screen lg:grid-cols-[280px_1fr]">
        <aside className="border-r border-slate-200 bg-slate-950 px-4 py-5 text-slate-100">
          <div className="mb-8 rounded-2xl border border-slate-800 bg-slate-900 px-4 py-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Onyx Tether
            </p>
            <p className="mt-2 text-sm font-semibold text-white">{companyName}</p>
            <p className="mt-1 text-xs text-slate-400">Owner Portal</p>
          </div>

          <nav className="space-y-1">
            <NavItem href="/dashboard" icon={<LayoutDashboard className="h-4 w-4" />} label="Dashboard" />
            <NavItem href="/dashboard/assets" icon={<Blocks className="h-4 w-4" />} label="Fleet Inventory" />
            <NavItem href="/dashboard/sites" icon={<MapPinned className="h-4 w-4" />} label="Sites & Map" />
            <NavItem href="/dashboard/workers" icon={<HardHat className="h-4 w-4" />} label="Workers" />
            <NavItem href="/dashboard/maintenance" icon={<Wrench className="h-4 w-4" />} label="Maintenance Ledger" />
            <NavItem href="/dashboard/settings" icon={<Settings className="h-4 w-4" />} label="Settings" />
          </nav>
        </aside>

        <div className="min-w-0">
          <header className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur md:px-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Company
              </p>
              <h1 className="text-lg font-semibold tracking-tight text-slate-900">{companyName}</h1>
            </div>

            <button className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left shadow-sm transition hover:bg-slate-50">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-slate-900 text-xs font-semibold text-white">
                {userName
                  .split(" ")
                  .filter(Boolean)
                  .map((part) => part[0])
                  .slice(0, 2)
                  .join("")}
              </span>
              <span className="hidden sm:block">
                <span className="block text-sm font-medium text-slate-900">{userName}</span>
                <span className="block text-xs capitalize text-slate-500">{profile?.role ?? "owner"}</span>
              </span>
              <ChevronDown className="h-4 w-4 text-slate-400" />
            </button>
          </header>

          <main className="px-4 py-5 md:px-6">{children}</main>
        </div>
      </div>
    </div>
  );
}

function NavItem({
  href,
  icon,
  label,
}: {
  href: string;
  icon: ReactNode;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-slate-300 transition hover:bg-slate-900 hover:text-white"
    >
      <span className="text-slate-400">{icon}</span>
      <span>{label}</span>
    </Link>
  );
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
