"use client";

import { ShieldAlert, FileDown, Truck } from "lucide-react";

export type LiabilityLedgerRow = {
  workerId: string;
  fullName: string;
  phoneNumber: string | null;
  isExternal: boolean;
  totalValueHeld: number;
  itemCount: number;
  items: Array<{
    assetName: string;
    tagId: string;
    siteName: string | null;
    value: number;
  }>;
};

export default function LiabilityLedger({ rows }: { rows: LiabilityLedgerRow[] }) {
  const generateDischargeReport = (row: LiabilityLedgerRow) => {
    const lines = [
      "Onyx Tether - Subcontractor/Worker Discharge Report",
      `Worker: ${row.fullName}`,
      `Phone: ${row.phoneNumber ?? "N/A"}`,
      `External: ${row.isExternal ? "Yes" : "No"}`,
      `Active Items: ${row.itemCount}`,
      `Total Liability Value: ${formatCurrency(row.totalValueHeld)}`,
      "",
      "Items Held:",
      ...row.items.map(
        (item, index) =>
          `${index + 1}. ${item.assetName} (${item.tagId}) - ${formatCurrency(item.value)} - ${item.siteName ?? "Yard"}`,
      ),
      "",
      `Generated: ${new Date().toISOString()}`,
    ];

    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `discharge-report-${row.fullName.toLowerCase().replace(/\s+/g, "-")}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Liability Ledger</h2>
          <p className="text-sm text-slate-500">
            Total held asset value by worker, with subcontractor risk highlighting.
          </p>
        </div>
        <ShieldAlert className="h-5 w-5 text-slate-400" />
      </div>

      <div className="max-h-[520px] overflow-auto">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase tracking-[0.12em] text-slate-500">
            <tr>
              <th className="px-5 py-3">Worker</th>
              <th className="px-5 py-3">Type</th>
              <th className="px-5 py-3 text-center">Items Held</th>
              <th className="px-5 py-3 text-right">Liability Value</th>
              <th className="px-5 py-3 text-right">Report</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.workerId}
                className={[
                  "border-t border-slate-100",
                  row.isExternal ? "bg-amber-50/40" : "hover:bg-slate-50/70",
                ].join(" ")}
              >
                <td className="px-5 py-3">
                  <div className="font-medium text-slate-900">{row.fullName}</div>
                  <div className="mt-0.5 text-xs text-slate-500">{row.phoneNumber ?? "No phone"}</div>
                </td>
                <td className="px-5 py-3">
                  {row.isExternal ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
                      <Truck className="h-3.5 w-3.5" />
                      Subcontractor
                    </span>
                  ) : (
                    <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700">
                      Internal
                    </span>
                  )}
                </td>
                <td className="px-5 py-3 text-center font-semibold text-slate-900">{row.itemCount}</td>
                <td className="px-5 py-3 text-right font-semibold text-slate-900">
                  {formatCurrency(row.totalValueHeld)}
                </td>
                <td className="px-5 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => generateDischargeReport(row)}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <FileDown className="h-3.5 w-3.5" />
                    Discharge Report
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-8 text-center text-slate-500">
                  No active checkouts to report.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(value);
}

