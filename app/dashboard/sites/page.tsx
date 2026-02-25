import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { completeSite, createSite } from "../../actions/site-actions";
import { Factory, MapPinned, PlusCircle } from "lucide-react";

export default async function SitesPage() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return <PanelMessage>Sign in required.</PanelMessage>;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("company_id")
    .eq("id", user.id)
    .single<{ company_id: string }>();

  if (!profile?.company_id) {
    return <PanelMessage>No company found for this user.</PanelMessage>;
  }

  const companyId = profile.company_id;

  const [sitesResult, managersResult, activeAssetLocationsResult] = await Promise.all([
    supabase
      .from("sites")
      .select(
        `
        id,
        name,
        status,
        manager:profiles!sites_manager_id_fkey (id, full_name)
      `,
      )
      .eq("company_id", companyId)
      .order("created_at", { ascending: false }),
    supabase
      .from("profiles")
      .select("id, full_name")
      .eq("company_id", companyId)
      .in("role", ["owner", "site_manager"])
      .eq("is_active", true)
      .order("full_name", { ascending: true }),
    supabase
      .from("assets")
      .select(
        `
        id,
        name,
        status,
        current_site:sites!assets_current_site_id_fkey (id, name),
        latest_log:logs!logs_asset_id_fkey (latitude, longitude, created_at)
      `,
      )
      .eq("company_id", companyId)
      .eq("status", "on_site")
      .order("created_at", { foreignTable: "latest_log", ascending: false }),
  ]);

  const sites = (sitesResult.data ?? []) as Array<{
    id: string;
    name: string;
    status: "active" | "completed";
    manager: { id: string; full_name: string | null } | null;
  }>;
  const managers = (managersResult.data ?? []) as Array<{ id: string; full_name: string | null }>;
  const rawAssetLocations = (activeAssetLocationsResult.data ?? []) as Array<{
    id: string;
    name: string;
    status: string;
    current_site: { id: string; name: string | null } | null;
    latest_log:
      | Array<{ latitude: number | null; longitude: number | null; created_at: string }>
      | { latitude: number | null; longitude: number | null; created_at: string }
      | null;
  }>;

  const activeSites = sites.filter((s) => s.status === "active");

  const mapPoints = rawAssetLocations
    .map((asset) => {
      const latest = Array.isArray(asset.latest_log) ? asset.latest_log[0] : asset.latest_log;
      if (!latest?.latitude || !latest?.longitude) return null;
      return {
        assetName: asset.name,
        siteName: asset.current_site?.name ?? "Unknown Site",
        lat: Number(latest.latitude),
        lng: Number(latest.longitude),
      };
    })
    .filter(Boolean) as Array<{ assetName: string; siteName: string; lat: number; lng: number }>;

  return (
    <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
      <section className="space-y-5">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              Site Lifecycle
            </p>
            <h1 className="mt-1 text-xl font-semibold tracking-tight text-slate-900">
              Sites & Jobs
            </h1>
          </div>

          <details className="group">
            <summary className="list-none">
              <span className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800">
                <PlusCircle className="h-4 w-4" />
                Open New Site
              </span>
            </summary>

            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <form
                action={async (formData) => {
                  "use server";
                  await createSite(
                    String(formData.get("name") ?? ""),
                    String(formData.get("manager_id") ?? ""),
                  );
                }}
                className="space-y-3"
              >
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium text-slate-700">Site name</span>
                  <input
                    name="name"
                    placeholder="Aston Site Compound"
                    required
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm focus:border-slate-900 focus:outline-none"
                  />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium text-slate-700">Site manager</span>
                  <select
                    name="manager_id"
                    required
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm focus:border-slate-900 focus:outline-none"
                  >
                    <option value="">Select manager</option>
                    {managers.map((manager) => (
                      <option key={manager.id} value={manager.id}>
                        {manager.full_name ?? "Unnamed"}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="submit"
                  className="w-full rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500"
                >
                  Create Site
                </button>
              </form>
            </div>
          </details>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-base font-semibold text-slate-900">Active Jobs</h2>
            <p className="text-sm text-slate-500">Close jobs only after assets are returned or transferred.</p>
          </div>

          <div className="space-y-3 p-4">
            {activeSites.map((site) => (
              <div
                key={site.id}
                className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 md:flex-row md:items-center md:justify-between"
              >
                <div>
                  <div className="font-semibold text-slate-900">{site.name}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    Manager: {site.manager?.full_name ?? "Unassigned"}
                  </div>
                </div>

                <form
                  action={async () => {
                    "use server";
                    await completeSite(site.id);
                  }}
                >
                  <button
                    type="submit"
                    className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-100"
                  >
                    Close Job
                  </button>
                </form>
              </div>
            ))}

            {activeSites.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                No active sites.
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Live Site Map</h2>
            <p className="text-sm text-slate-500">
              Latest GPS pings from on-site assets (from audit logs)
            </p>
          </div>
          <MapPinned className="h-5 w-5 text-slate-400" />
        </div>

        <div className="p-5">
          <PseudoMap points={mapPoints} />
        </div>
      </section>
    </div>
  );
}

function PseudoMap({
  points,
}: {
  points: Array<{ assetName: string; siteName: string; lat: number; lng: number }>;
}) {
  if (points.length === 0) {
    return (
      <div className="grid h-[520px] place-items-center rounded-2xl border border-slate-200 bg-slate-50 text-sm text-slate-500">
        No GPS points available for active assets yet.
      </div>
    );
  }

  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  const latSpan = Math.max(maxLat - minLat, 0.01);
  const lngSpan = Math.max(maxLng - minLng, 0.01);

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200">
      <div className="relative h-[520px] bg-[radial-gradient(circle_at_20%_20%,#e2e8f0_1px,transparent_1px)] [background-size:20px_20px]">
        <div className="absolute inset-0 bg-gradient-to-br from-slate-100 via-white to-slate-200" />
        <div className="absolute inset-0 border border-slate-200/70" />

        {points.map((point, index) => {
          const x = ((point.lng - minLng) / lngSpan) * 100;
          const y = 100 - ((point.lat - minLat) / latSpan) * 100;
          return (
            <div
              key={`${point.assetName}-${index}`}
              className="absolute"
              style={{ left: `${x}%`, top: `${y}%`, transform: "translate(-50%, -50%)" }}
              title={`${point.assetName} • ${point.siteName}`}
            >
              <div className="relative">
                <span className="absolute inset-0 animate-ping rounded-full bg-sky-400/40" />
                <span className="relative block h-3 w-3 rounded-full border-2 border-white bg-sky-500 shadow" />
              </div>
            </div>
          );
        })}

        <div className="absolute bottom-3 left-3 rounded-lg border border-slate-200 bg-white/90 px-3 py-2 text-xs text-slate-600 shadow-sm">
          <div className="font-semibold text-slate-800">GPS Plot (Preview)</div>
          <div>Replace with Leaflet/react-map-gl when the map library is installed.</div>
        </div>
      </div>
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
