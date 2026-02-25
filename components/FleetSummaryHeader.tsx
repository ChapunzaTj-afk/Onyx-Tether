import type { ReactNode } from "react";
import { Ban, CircleDollarSign, ShieldAlert, Wrench, Ghost } from "lucide-react";

type FleetSummaryHeaderProps = {
  totalFleetValue: number;
  atRiskValue: number;
  quarantineCount: number;
  complianceWarningCount: number;
  lostWrittenOffTotal: number;
};

export default function FleetSummaryHeader({
  totalFleetValue,
  atRiskValue,
  quarantineCount,
  complianceWarningCount,
  lostWrittenOffTotal,
}: FleetSummaryHeaderProps) {
  return (
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
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
      <MetricCard
        label="Lost / Written Off (FY)"
        value={formatCurrency(lostWrittenOffTotal)}
        tone="danger"
        icon={<Ghost className="h-4 w-4" />}
      />
    </section>
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

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(value);
}

