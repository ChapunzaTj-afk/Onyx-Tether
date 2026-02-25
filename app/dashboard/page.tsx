import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import {
  AlertTriangle,
  Ban,
  CircleDollarSign,
  ShieldAlert,
  Wrench,
  ArrowRightLeft,
} from "lucide-react";

type AssetRow = {
  id: string;
  name: string;
  value: number | null;
  status: string;
  is_active: boolean;
  next_service_date: string | null;
  last_checkout_date: string | null;
  current_site_id: string | null;
};

type FeedItem = {
  id: string;
  severity: "critical" | "warning";
  title: string;
  subtitle: string;
  icon: ReactNode;
};

export default async function DashboardPage() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
        Sign in required.
      </div>
    );
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("company_id")
    .eq("id", user.id)
    .single<{ company_id: string }>();

  if (!profile?.company_id) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
        Company not configured yet. Complete onboarding first.
      </div>
    );
  }

  const companyId = profile.company_id;
  const now = new Date();
  const overdueCutoff = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const complianceCutoff = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const [
    assetsResult,
    overdueFeedResult,
    pendingTransfersResult,
    activeSitesResult,
    serializedSiteAssetsResult,
    bulkSiteInventoryResult,
  ] = await Promise.all([
    supabase
      .from("assets")
      .select("id, name, value, status, is_active, next_service_date, last_checkout_date, current_site_id")
      .eq("company_id", companyId),
    supabase
      .from("assets")
      .select(
        `
        id,
        name,
        last_checkout_date,
        assigned_user:profiles!assets_assigned_user_id_fkey (full_name, nuisance_score),
        current_site:sites!assets_current_site_id_fkey (name)
      `,
      )
      .eq("company_id", companyId)
      .eq("status", "on_site")
      .lt("last_checkout_date", overdueCutoff.toISOString())
      .order("last_checkout_date", { ascending: true })
      .limit(8),
    supabase
      .from("assets")
      .select(
        `
        id,
        name,
        assigned_user:profiles!assets_assigned_user_id_fkey (full_name),
        pending_recipient:profiles!assets_pending_transfer_user_id_fkey (full_name)
      `,
      )
      .eq("company_id", companyId)
      .eq("status", "transfer_pending")
      .limit(8),
    supabase
      .from("sites")
      .select(
        `
        id,
        name,
        manager:profiles!sites_manager_id_fkey (full_name)
      `,
      )
      .eq("company_id", companyId)
      .eq("status", "active")
      .order("created_at", { ascending: false }),
    supabase
      .from("assets")
      .select("current_site_id")
      .eq("company_id", companyId)
      .in("status", ["on_site", "transfer_pending"])
      .not("current_site_id", "is", null),
    supabase
      .from("site_bulk_inventory")
      .select("site_id, quantity_on_site")
      .eq("company_id", companyId),
  ]);

  const assets = (assetsResult.data ?? []) as AssetRow[];

  const activeAssets = assets.filter((a) => a.is_active);
  const totalFleetValue = activeAssets.reduce((sum, a) => sum + Number(a.value ?? 0), 0);
  const atRiskValue = activeAssets
    .filter(
      (a) =>
        a.status === "on_site" &&
        a.last_checkout_date &&
        new Date(a.last_checkout_date).getTime() < overdueCutoff.getTime(),
    )
    .reduce((sum, a) => sum + Number(a.value ?? 0), 0);
  const quarantineCount = activeAssets.filter((a) => a.status === "quarantine").length;
  const complianceWarningCount = activeAssets.filter((a) => {
    if (!a.next_service_date) return false;
    const due = new Date(a.next_service_date);
    if (Number.isNaN(due.getTime())) return false;
    // Proxy until a dedicated "heavy plant" classification exists in schema.
    return due >= now && due <= complianceCutoff;
  }).length;

  const onSiteCount = activeAssets.filter(
    (a) => a.status === "on_site" || a.status === "transfer_pending",
  ).length;
  const inYardCount = activeAssets.filter((a) => a.status === "in_yard").length;
  const quarantineStatusCount = activeAssets.filter((a) => a.status === "quarantine").length;
  const utilizationBase = Math.max(activeAssets.length, 1);

  const overdueFeed = (overdueFeedResult.data ?? []) as Array<{
    id: string;
    name: string;
    last_checkout_date: string | null;
    assigned_user: { full_name: string | null; nuisance_score: number | null } | null;
    current_site: { name: string | null } | null;
  }>;
  const pendingTransfers = (pendingTransfersResult.data ?? []) as Array<{
    id: string;
    name: string;
    assigned_user: { full_name: string | null } | null;
    pending_recipient: { full_name: string | null } | null;
  }>;

  const feedItems: FeedItem[] = [
    ...overdueFeed
      .filter((item) => (item.assigned_user?.nuisance_score ?? 0) > 0)
      .map((item) => ({
        id: `nag-${item.id}`,
        severity: (item.assigned_user?.nuisance_score ?? 0) >= 3 ? "critical" : "warning",
        icon: <AlertTriangle className="h-4 w-4" />,
        title: `${item.assigned_user?.full_name ?? "Worker"} has ignored ${item.assigned_user?.nuisance_score ?? 0} SMS warnings`,
        subtitle: `${item.name} at ${item.current_site?.name ?? "Unknown Site"} is overdue for return.`,
      })),
    ...pendingTransfers.map((item) => ({
      id: `transfer-${item.id}`,
      severity: "warning" as const,
      icon: <ArrowRightLeft className="h-4 w-4" />,
      title: `Pending Transfer: ${item.pending_recipient?.full_name ?? "Worker"} is waiting to accept ${item.name}`,
      subtitle: `Requested by ${item.assigned_user?.full_name ?? "Unknown worker"}.`,
    })),
  ].slice(0, 10);

  const activeSites = (activeSitesResult.data ?? []) as Array<{
    id: string;
    name: string;
    manager: { full_name: string | null } | null;
  }>;
  const serializedRows = (serializedSiteAssetsResult.data ?? []) as Array<{ current_site_id: string | null }>;
  const bulkRows = (bulkSiteInventoryResult.data ?? []) as Array<{ site_id: string; quantity_on_site: number }>;

  const deployedBySite = new Map<string, number>();
  for (const row of serializedRows) {
    if (!row.current_site_id) continue;
    deployedBySite.set(row.current_site_id, (deployedBySite.get(row.current_site_id) ?? 0) + 1);
  }
  for (const row of bulkRows) {
    deployedBySite.set(row.site_id, (deployedBySite.get(row.site_id) ?? 0) + Number(row.quantity_on_site ?? 0));
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Total Fleet Value"
          value={formatCurrency(totalFleetValue)}
          tone="neutral"
          icon={<CircleDollarSign className="h-4 w-4" />}
        />
        <MetricCard
          label="At Risk (14+ Days)"
          value={formatCurrency(atRiskValue)}
          tone="danger"
          icon={<ShieldAlert className="h-4 w-4" />}
        />
        <MetricCard
          label="Quarantine / Broken"
          value={String(quarantineCount)}
          tone="warning"
          icon={<Ban className="h-4 w-4" />}
        />
        <MetricCard
          label="Compliance Warning (30d)"
          value={String(complianceWarningCount)}
          tone="warning"
          icon={<Wrench className="h-4 w-4" />}
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <ActionFeedCard items={feedItems} />
        <UtilizationCard
          onSite={onSiteCount}
          inYard={inYardCount}
          quarantine={quarantineStatusCount}
          total={utilizationBase}
        />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Active Sites Quick-View</h2>
            <p className="text-sm text-slate-500">
              Live deployed asset counts by site (serialized + bulk quantities)
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-[0.12em] text-slate-500">
              <tr>
                <th className="px-5 py-3">Site</th>
                <th className="px-5 py-3">Site Manager</th>
                <th className="px-5 py-3 text-right">Assets Deployed</th>
              </tr>
            </thead>
            <tbody>
              {activeSites.map((site) => (
                <tr key={site.id} className="border-t border-slate-100">
                  <td className="px-5 py-3 font-medium text-slate-900">{site.name}</td>
                  <td className="px-5 py-3 text-slate-600">
                    {site.manager?.full_name ?? "Unassigned"}
                  </td>
                  <td className="px-5 py-3 text-right font-semibold text-slate-900">
                    {deployedBySite.get(site.id) ?? 0}
                  </td>
                </tr>
              ))}
              {activeSites.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-5 py-8 text-center text-slate-500">
                    No active sites yet.
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

function MetricCard({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: string;
  tone: "neutral" | "danger" | "warning";
  icon: ReactNode;
}) {
  const toneClasses =
    tone === "danger"
      ? "border-rose-200 bg-rose-50 text-rose-700"
      : tone === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-slate-200 bg-white text-slate-700";

  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${toneClasses}`}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-[0.14em]">{label}</p>
        <span>{icon}</span>
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight">{value}</p>
    </div>
  );
}

function ActionFeedCard({ items }: { items: FeedItem[] }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-5 py-4">
        <h2 className="text-base font-semibold text-slate-900">Action Required</h2>
        <p className="text-sm text-slate-500">
          Immediate bottlenecks and ignored warnings that need owner intervention.
        </p>
      </div>

      <div className="max-h-[420px] space-y-3 overflow-y-auto p-4">
        {items.length === 0 ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-700">
            No urgent issues right now.
          </div>
        ) : null}

        {items.map((item) => (
          <div
            key={item.id}
            className={[
              "rounded-xl border px-4 py-3 shadow-sm",
              item.severity === "critical"
                ? "border-rose-200 bg-rose-50"
                : "border-amber-200 bg-amber-50",
            ].join(" ")}
          >
            <div className="flex items-start gap-3">
              <span
                className={[
                  "mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg",
                  item.severity === "critical"
                    ? "bg-rose-100 text-rose-700"
                    : "bg-amber-100 text-amber-700",
                ].join(" ")}
              >
                {item.icon}
              </span>
              <div>
                <p className="text-sm font-semibold text-slate-900">{item.title}</p>
                <p className="mt-1 text-sm text-slate-700">{item.subtitle}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function UtilizationCard({
  onSite,
  inYard,
  quarantine,
  total,
}: {
  onSite: number;
  inYard: number;
  quarantine: number;
  total: number;
}) {
  const onSitePct = Math.round((onSite / total) * 100);
  const inYardPct = Math.round((inYard / total) * 100);
  const quarantinePct = Math.max(0, 100 - onSitePct - inYardPct);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-base font-semibold text-slate-900">Fleet Utilization</h2>
      <p className="text-sm text-slate-500">
        On-site (earning) vs idle yard stock vs quarantine drag.
      </p>

      <div className="mt-6">
        <div className="h-4 overflow-hidden rounded-full bg-slate-100">
          <div className="flex h-full w-full">
            <div className="bg-emerald-500" style={{ width: `${onSitePct}%` }} />
            <div className="bg-slate-400" style={{ width: `${inYardPct}%` }} />
            <div className="bg-rose-500" style={{ width: `${quarantinePct}%` }} />
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-3">
        <LegendRow label="On Site (making money)" value={`${onSite} (${onSitePct}%)`} dot="bg-emerald-500" />
        <LegendRow label="In Yard (idle)" value={`${inYard} (${inYardPct}%)`} dot="bg-slate-400" />
        <LegendRow label="Quarantine (costing money)" value={`${quarantine} (${quarantinePct}%)`} dot="bg-rose-500" />
      </div>
    </section>
  );
}

function LegendRow({
  label,
  value,
  dot,
}: {
  label: string;
  value: string;
  dot: string;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
        <span className="text-sm text-slate-700">{label}</span>
      </div>
      <span className="text-sm font-semibold text-slate-900">{value}</span>
    </div>
  );
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
