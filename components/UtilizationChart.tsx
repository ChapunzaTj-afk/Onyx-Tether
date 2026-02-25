"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type UtilizationDatum = {
  date: string;
  onSite: number;
  inYard: number;
};

export default function UtilizationChart({ data }: { data: UtilizationDatum[] }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-base font-semibold text-slate-900">Fleet Utilization Trend</h2>
      <p className="text-sm text-slate-500">
        Last 30 days of working vs idle fleet count (waste analysis).
      </p>

      <div className="mt-5 h-72">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
            <defs>
              <linearGradient id="onyxOnSite" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0.03} />
              </linearGradient>
              <linearGradient id="onyxInYard" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#64748b" stopOpacity={0.35} />
                <stop offset="95%" stopColor="#64748b" stopOpacity={0.03} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11, fill: "#64748b" }}
              tickLine={false}
              axisLine={false}
              minTickGap={16}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "#64748b" }}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
              width={28}
            />
            <Tooltip
              contentStyle={{
                borderRadius: 12,
                border: "1px solid #e2e8f0",
                background: "#ffffff",
                boxShadow: "0 8px 24px rgba(15,23,42,0.08)",
                fontSize: 12,
              }}
            />
            <Area
              type="monotone"
              dataKey="onSite"
              name="Active on Site"
              stroke="#10b981"
              strokeWidth={2}
              fill="url(#onyxOnSite)"
            />
            <Area
              type="monotone"
              dataKey="inYard"
              name="Idle in Yard"
              stroke="#64748b"
              strokeWidth={2}
              fill="url(#onyxInYard)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

