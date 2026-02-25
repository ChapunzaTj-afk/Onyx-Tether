import type { ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { Filter, Search, SlidersHorizontal, Tag } from "lucide-react";
import AddAssetSlideOver from "../../../components/AddAssetSlideOver";

type InventoryPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function InventoryPage({ searchParams }: InventoryPageProps) {
  const params = searchParams ? await searchParams : {};
  const q = getParam(params, "q");
  const statusFilter = getParam(params, "status");
  const siteFilter = getParam(params, "site");
  const categoryFilter = getParam(params, "category");

  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return <PanelMessage tone="warning">Sign in required to view fleet inventory.</PanelMessage>;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("company_id")
    .eq("id", user.id)
    .single<{ company_id: string }>();

  if (!profile?.company_id) {
    return <PanelMessage tone="warning">No company workspace found for this user.</PanelMessage>;
  }

  const companyId = profile.company_id;

  const [sitesResult, assetsResult, bulkInventoryResult] = await Promise.all([
    supabase
      .from("sites")
      .select("id, name")
      .eq("company_id", companyId)
      .order("name", { ascending: true }),
    supabase
      .from("assets")
      .select(
        `
        id,
        name,
        tag_id,
        status,
        value,
        next_service_date,
        is_bulk,
        total_quantity,
        current_site_id,
        assigned_user:profiles!assets_assigned_user_id_fkey (full_name),
        current_site:sites!assets_current_site_id_fkey (name)
      `,
      )
      .eq("company_id", companyId)
      .order("created_at", { ascending: false }),
    supabase
      .from("site_bulk_inventory")
      .select(
        `
        asset_id,
        site_id,
        quantity_on_site,
        site:sites!site_bulk_inventory_site_id_fkey (name)
      `,
      )
      .eq("company_id", companyId),
  ]);

  const sites = (sitesResult.data ?? []) as Array<{ id: string; name: string }>;
  const assets = (assetsResult.data ?? []) as Array<{
    id: string;
    name: string;
    tag_id: string;
    status: string;
    value: number | null;
    next_service_date: string | null;
    is_bulk: boolean | null;
    total_quantity: number | null;
    current_site_id: string | null;
    assigned_user: { full_name: string | null } | null;
    current_site: { name: string | null } | null;
  }>;
  const bulkRows = (bulkInventoryResult.data ?? []) as Array<{
    asset_id: string;
    site_id: string;
    quantity_on_site: number;
    site: { name: string | null } | null;
  }>;

  const bulkByAsset = new Map<string, Array<{ siteName: string; quantity: number }>>();
  for (const row of bulkRows) {
    const list = bulkByAsset.get(row.asset_id) ?? [];
    list.push({
      siteName: row.site?.name ?? "Unknown Site",
      quantity: Number(row.quantity_on_site ?? 0),
    });
    bulkByAsset.set(row.asset_id, list);
  }

  const filteredAssets = assets.filter((asset) => {
    const matchesSearch =
      !q ||
      asset.name.toLowerCase().includes(q.toLowerCase()) ||
      asset.tag_id.toLowerCase().includes(q.toLowerCase());
    const matchesStatus = !statusFilter || statusFilter === "all" || asset.status === statusFilter;
    const matchesSite =
      !siteFilter ||
      siteFilter === "all" ||
      asset.current_site_id === siteFilter ||
      (asset.is_bulk &&
        (bulkByAsset.get(asset.id) ?? []).some((entry) =>
          sites.find((s) => s.id === siteFilter)?.name === entry.siteName,
        ));
    const matchesCategory =
      !categoryFilter ||
      categoryFilter === "all" ||
      (categoryFilter === "bulk" ? Boolean(asset.is_bulk) : !asset.is_bulk);

    return matchesSearch && matchesStatus && matchesSite && matchesCategory;
  });

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <form className="grid gap-3 lg:grid-cols-[1.4fr_repeat(3,0.8fr)_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Search by asset name or tag ID..."
              className="w-full rounded-xl border border-slate-300 bg-white pl-9 pr-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none"
            />
          </div>

          <FilterSelect
            icon={<SlidersHorizontal className="h-4 w-4" />}
            name="status"
            defaultValue={statusFilter || "all"}
            options={[
              { value: "all", label: "All Statuses" },
              { value: "in_yard", label: "In Yard" },
              { value: "on_site", label: "On Site" },
              { value: "quarantine", label: "Quarantine" },
              { value: "transfer_pending", label: "Transfer Pending" },
            ]}
          />

          <FilterSelect
            icon={<Tag className="h-4 w-4" />}
            name="site"
            defaultValue={siteFilter || "all"}
            options={[
              { value: "all", label: "All Sites" },
              ...sites.map((site) => ({ value: site.id, label: site.name })),
            ]}
          />

          <FilterSelect
            icon={<Filter className="h-4 w-4" />}
            name="category"
            defaultValue={categoryFilter || "all"}
            options={[
              { value: "all", label: "All Categories" },
              { value: "serialized", label: "Serialized" },
              { value: "bulk", label: "Bulk Material" },
            ]}
          />

          <div className="flex items-center gap-2">
            <button
              type="submit"
              className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Apply
            </button>
            <AddAssetSlideOver />
          </div>
        </form>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">Fleet Inventory</h2>
          <p className="text-sm text-slate-500">
            Master inventory across serialized tools and bulk materials.
          </p>
        </div>

        <div className="max-h-[70vh] overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs uppercase tracking-[0.12em] text-slate-500">
              <tr>
                <th className="px-5 py-3">Asset Name</th>
                <th className="px-5 py-3">Tag ID</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Assigned To / Location</th>
                <th className="px-5 py-3 text-right">Total Value</th>
                <th className="px-5 py-3">Next Service</th>
              </tr>
            </thead>
            <tbody>
              {filteredAssets.map((asset) => {
                const bulkDistribution = bulkByAsset.get(asset.id) ?? [];
                const totalOnSite = bulkDistribution.reduce((sum, row) => sum + row.quantity, 0);
                const totalQty = Number(asset.total_quantity ?? 1);
                const yardQty = Math.max(0, totalQty - totalOnSite);

                return (
                  <tr key={asset.id} className="border-t border-slate-100 hover:bg-slate-50/70">
                    <td className="px-5 py-3">
                      <Link
                        href={`/dashboard/inventory/${asset.id}`}
                        className="font-semibold text-slate-900 hover:text-slate-700"
                      >
                        {asset.name}
                      </Link>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {asset.is_bulk ? "Bulk Material" : "Serialized Asset"}
                      </p>
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-slate-700">{asset.tag_id}</td>
                    <td className="px-5 py-3">
                      <StatusBadge status={asset.status} />
                    </td>
                    <td className="px-5 py-3 text-slate-700">
                      {asset.is_bulk ? (
                        <BulkDistributionCell
                          totalQty={totalQty}
                          yardQty={yardQty}
                          distribution={bulkDistribution}
                        />
                      ) : (
                        <>
                          <div className="font-medium text-slate-900">
                            {asset.assigned_user?.full_name ?? "Unassigned"}
                          </div>
                          <div className="text-xs text-slate-500">
                            {asset.current_site?.name ?? "Yard"}
                          </div>
                        </>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right font-semibold text-slate-900">
                      {formatCurrency(Number(asset.value ?? 0))}
                    </td>
                    <td className="px-5 py-3 text-slate-700">
                      {asset.next_service_date ? (
                        <ServiceDateCell value={asset.next_service_date} />
                      ) : (
                        <span className="text-slate-400">Not set</span>
                      )}
                    </td>
                  </tr>
                );
              })}

              {filteredAssets.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-slate-500">
                    No assets match the current filters.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function BulkDistributionCell({
  totalQty,
  yardQty,
  distribution,
}: {
  totalQty: number;
  yardQty: number;
  distribution: Array<{ siteName: string; quantity: number }>;
}) {
  const line = [
    `${totalQty} Total`,
    `${yardQty} Yard`,
    ...distribution.map((row) => `${row.quantity} ${row.siteName}`),
  ].join(", ");

  return (
    <div>
      <div className="font-medium text-slate-900">{line}</div>
      <div className="mt-0.5 text-xs text-slate-500">Distributed quantity by site</div>
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

function ServiceDateCell({ value }: { value: string }) {
  const date = new Date(value);
  const now = new Date();
  const inPast = date.getTime() < now.getTime();

  return (
    <span
      className={[
        "inline-flex rounded-lg border px-2 py-1 text-xs font-medium",
        inPast
          ? "border-rose-200 bg-rose-50 text-rose-700"
          : "border-slate-200 bg-slate-50 text-slate-700",
      ].join(" ")}
    >
      {date.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })}
    </span>
  );
}

function FilterSelect({
  icon,
  name,
  defaultValue,
  options,
}: {
  icon: ReactNode;
  name: string;
  defaultValue: string;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
        {icon}
      </span>
      <select
        name={name}
        defaultValue={defaultValue}
        className="w-full appearance-none rounded-xl border border-slate-300 bg-white pl-9 pr-8 py-2.5 text-sm text-slate-700 focus:border-slate-900 focus:outline-none"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function PanelMessage({
  children,
  tone,
}: {
  children: ReactNode;
  tone: "warning" | "neutral";
}) {
  return (
    <div
      className={[
        "rounded-2xl border p-5 text-sm",
        tone === "warning"
          ? "border-amber-200 bg-amber-50 text-amber-800"
          : "border-slate-200 bg-white text-slate-700",
      ].join(" ")}
    >
      {children}
    </div>
  );
}

function getParam(params: Record<string, string | string[] | undefined>, key: string) {
  const value = params[key];
  return Array.isArray(value) ? value[0] ?? "" : (value ?? "");
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

