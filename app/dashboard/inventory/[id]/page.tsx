import type { ReactNode } from "react";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import {
  ArrowUpRight,
  ClipboardList,
  ImageIcon,
  MapPin,
  ShieldAlert,
  Tag,
  Wrench,
} from "lucide-react";

type AssetDrilldownPageProps = {
  params: Promise<{ id: string }>;
};

export default async function AssetDrilldownPage({ params }: AssetDrilldownPageProps) {
  const { id } = await params;
  const supabase = await getSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return notFound();

  const { data: profile } = await supabase
    .from("profiles")
    .select("company_id")
    .eq("id", user.id)
    .single<{ company_id: string }>();

  if (!profile?.company_id) return notFound();

  const companyId = profile.company_id;

  const [assetResult, maintenanceResult, logsResult, bulkInventoryResult] = await Promise.all([
    supabase
      .from("assets")
      .select(
        `
        id,
        name,
        tag_id,
        status,
        value,
        is_bulk,
        total_quantity,
        next_service_date,
        current_site:sites!assets_current_site_id_fkey (name),
        assigned_user:profiles!assets_assigned_user_id_fkey (full_name)
      `,
      )
      .eq("id", id)
      .eq("company_id", companyId)
      .single<{
        id: string;
        name: string;
        tag_id: string;
        status: string;
        value: number | null;
        is_bulk: boolean | null;
        total_quantity: number | null;
        next_service_date: string | null;
        current_site: { name: string | null } | null;
        assigned_user: { full_name: string | null } | null;
      }>(),
    supabase
      .from("maintenance_logs")
      .select(
        `
        id,
        repair_cost,
        description,
        service_date,
        logged_by:profiles!maintenance_logs_logged_by_user_id_fkey (full_name)
      `,
      )
      .eq("asset_id", id)
      .eq("company_id", companyId)
      .order("service_date", { ascending: false }),
    supabase
      .from("logs")
      .select(
        `
        id,
        action,
        condition,
        notes,
        damage_photo_url,
        created_at,
        latitude,
        longitude,
        location_accuracy_meters,
        user:profiles!logs_user_id_fkey (full_name),
        site:sites!logs_site_id_fkey (name)
      `,
      )
      .eq("asset_id", id)
      .eq("company_id", companyId)
      .order("created_at", { ascending: false }),
    supabase
      .from("site_bulk_inventory")
      .select(
        `
        quantity_on_site,
        site:sites!site_bulk_inventory_site_id_fkey (name)
      `,
      )
      .eq("asset_id", id)
      .eq("company_id", companyId),
  ]);

  if (!assetResult.data) return notFound();

  const asset = assetResult.data;
  const maintenanceRows = (maintenanceResult.data ?? []) as Array<{
    id: string;
    repair_cost: number;
    description: string;
    service_date: string;
    logged_by: { full_name: string | null } | null;
  }>;
  const logs = (logsResult.data ?? []) as Array<{
    id: string;
    action: string;
    condition: string | null;
    notes: string | null;
    damage_photo_url: string | null;
    created_at: string;
    latitude: number | null;
    longitude: number | null;
    location_accuracy_meters: number | null;
    user: { full_name: string | null } | null;
    site: { name: string | null } | null;
  }>;
  const bulkRows = (bulkInventoryResult.data ?? []) as Array<{
    quantity_on_site: number;
    site: { name: string | null } | null;
  }>;

  const totalMaintenanceSpend = maintenanceRows.reduce(
    (sum, row) => sum + Number(row.repair_cost ?? 0),
    0,
  );
  const bulkDistributed = bulkRows.reduce((sum, row) => sum + Number(row.quantity_on_site ?? 0), 0);
  const bulkTotal = Number(asset.total_quantity ?? 1);
  const bulkYard = Math.max(0, bulkTotal - bulkDistributed);

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              Asset Drilldown
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
              {asset.name}
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <StatusBadge status={asset.status} />
              <span className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-600">
                <Tag className="h-3.5 w-3.5" />
                {asset.tag_id}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <ActionButton icon={<Tag className="h-4 w-4" />} label="Reassign Tag" />
            <ActionButton icon={<Wrench className="h-4 w-4" />} label="Log Maintenance" />
            <ActionButton icon={<ShieldAlert className="h-4 w-4" />} label="Retire Asset" tone="danger" />
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-slate-900">Details & Financials</h2>
            <div className="mt-4 grid gap-3">
              <StatRow label="Purchase Value" value={formatCurrency(Number(asset.value ?? 0))} />
              <StatRow
                label="Current Location"
                value={asset.current_site?.name ?? (asset.status === "in_yard" ? "Yard" : "Unknown")}
              />
              <StatRow label="Assigned User" value={asset.assigned_user?.full_name ?? "Unassigned"} />
              <StatRow
                label="Next Service Date"
                value={
                  asset.next_service_date
                    ? new Date(asset.next_service_date).toLocaleDateString("en-GB", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })
                    : "Not set"
                }
              />
              {asset.is_bulk ? (
                <StatRow
                  label="Bulk Distribution"
                  value={`${bulkTotal} total • ${bulkYard} yard • ${bulkDistributed} deployed`}
                />
              ) : null}
              <StatRow label="Total Cost of Ownership (Repairs)" value={formatCurrency(totalMaintenanceSpend)} />
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Maintenance Ledger</h2>
                <p className="text-sm text-slate-500">Repair history and cost accumulation</p>
              </div>
            </div>
            <div className="max-h-[360px] overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase tracking-[0.12em] text-slate-500">
                  <tr>
                    <th className="px-5 py-3">Service Date</th>
                    <th className="px-5 py-3">Description</th>
                    <th className="px-5 py-3">Logged By</th>
                    <th className="px-5 py-3 text-right">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {maintenanceRows.map((row) => (
                    <tr key={row.id} className="border-t border-slate-100">
                      <td className="px-5 py-3 text-slate-700">
                        {new Date(row.service_date).toLocaleDateString("en-GB", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })}
                      </td>
                      <td className="px-5 py-3 text-slate-900">{row.description}</td>
                      <td className="px-5 py-3 text-slate-600">{row.logged_by?.full_name ?? "System"}</td>
                      <td className="px-5 py-3 text-right font-semibold text-slate-900">
                        {formatCurrency(Number(row.repair_cost ?? 0))}
                      </td>
                    </tr>
                  ))}
                  {maintenanceRows.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-5 py-8 text-center text-slate-500">
                        No maintenance records yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-base font-semibold text-slate-900">Immutable Audit Trail</h2>
            <p className="text-sm text-slate-500">
              Chronological movement, condition, and dispute evidence for this asset.
            </p>
          </div>

          <div className="max-h-[760px] overflow-y-auto px-5 py-5">
            <ol className="relative ml-3 border-l border-slate-200 pl-6">
              {logs.map((log) => {
                const isDamage = log.condition === "damaged" || log.action === "flag_damaged";
                const eventTone = isDamage
                  ? "border-rose-200 bg-rose-50"
                  : log.action.includes("transfer")
                    ? "border-amber-200 bg-amber-50"
                    : "border-slate-200 bg-white";

                return (
                  <li key={log.id} className="relative mb-4 last:mb-0">
                    <span
                      className={[
                        "absolute -left-[33px] top-4 h-3 w-3 rounded-full border-2 border-white shadow",
                        isDamage ? "bg-rose-500" : log.action.includes("transfer") ? "bg-amber-500" : "bg-slate-400",
                      ].join(" ")}
                    />

                    <div className={`rounded-xl border p-4 shadow-sm ${eventTone}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-slate-900">
                          {formatTimelineTitle(log)}
                        </p>
                        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                          <span>
                            {new Date(log.created_at).toLocaleString("en-GB", {
                              day: "2-digit",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                          {log.latitude != null && log.longitude != null ? (
                            <Link
                              href={`https://maps.google.com/?q=${log.latitude},${log.longitude}`}
                              target="_blank"
                              className="inline-flex items-center gap-1 font-medium text-sky-700 hover:text-sky-600"
                            >
                              <MapPin className="h-3.5 w-3.5" />
                              View Map Pin
                              <ArrowUpRight className="h-3.5 w-3.5" />
                            </Link>
                          ) : null}
                        </div>
                      </div>

                      {(log.notes || isDamage) && (
                        <div className="mt-2 rounded-lg border border-slate-200/70 bg-white/80 px-3 py-2 text-sm text-slate-700">
                          {log.notes || "Damage condition reported."}
                        </div>
                      )}

                      {log.damage_photo_url ? (
                        <details className="group mt-3">
                          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-slate-700">
                            <ImageIcon className="h-4 w-4" />
                            View damage photo
                          </summary>
                          <div className="mt-3">
                            <img
                              src={log.damage_photo_url}
                              alt="Damage evidence"
                              className="h-28 w-28 rounded-lg border border-slate-200 object-cover"
                            />
                          </div>
                          <div className="fixed inset-0 z-40 hidden items-center justify-center bg-slate-950/90 p-6 group-open:flex">
                            <div className="max-h-full max-w-4xl">
                              <img
                                src={log.damage_photo_url}
                                alt="Damage evidence fullscreen"
                                className="max-h-[85vh] w-auto rounded-xl border border-slate-700 object-contain shadow-2xl"
                              />
                              <p className="mt-3 text-center text-sm text-slate-300">
                                Click the timeline card again to close.
                              </p>
                            </div>
                          </div>
                        </details>
                      ) : null}
                    </div>
                  </li>
                );
              })}

              {logs.length === 0 ? (
                <li className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                  No audit events found for this asset yet.
                </li>
              ) : null}
            </ol>
          </div>
        </div>
      </section>
    </div>
  );
}

function ActionButton({
  icon,
  label,
  tone = "default",
}: {
  icon: ReactNode;
  label: string;
  tone?: "default" | "danger";
}) {
  return (
    <button
      type="button"
      className={[
        "inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium shadow-sm transition",
        tone === "danger"
          ? "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
      ].join(" ")}
    >
      {icon}
      {label}
    </button>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
      <span className="text-sm text-slate-600">{label}</span>
      <span className="text-sm font-semibold text-slate-900">{value}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const classes =
    status === "in_yard"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : status === "on_site"
        ? "border-sky-200 bg-sky-50 text-sky-700"
        : status === "quarantine"
          ? "border-rose-200 bg-rose-50 text-rose-700"
          : "border-slate-200 bg-slate-50 text-slate-700";

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${classes}`}>
      {status.replaceAll("_", " ")}
    </span>
  );
}

function formatTimelineTitle(log: {
  action: string;
  user: { full_name: string | null } | null;
  site: { name: string | null } | null;
}) {
  const actor = log.user?.full_name ?? "Unknown user";
  const site = log.site?.name ?? "Yard";

  switch (log.action) {
    case "checkout":
      return `Checked out by ${actor} to ${site}`;
    case "return":
      return `Returned by ${actor}`;
    case "transfer":
      return `Transfer requested by ${actor}`;
    case "transfer_accepted":
      return `Transferred and accepted by ${actor}`;
    case "flag_damaged":
      return `Damage flagged by ${actor}`;
    case "retire":
      return `Retired by ${actor}`;
    case "mark_lost":
      return `Marked lost by ${actor}`;
    case "bulk_checkout":
      return `Bulk quantity moved by ${actor} to ${site}`;
    default:
      return `${log.action.replaceAll("_", " ")} by ${actor}`;
  }
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(value);
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
