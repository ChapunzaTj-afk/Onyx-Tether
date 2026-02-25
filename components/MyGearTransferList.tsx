"use client";

import { useState, useTransition } from "react";
import { QrCode, SendHorizontal } from "lucide-react";
import { transferAsset } from "../app/actions/asset-actions";

type GearItem = {
  id: string;
  name: string;
  tagId: string;
  siteName: string | null;
};

type WorkerOption = {
  id: string;
  fullName: string;
};

export default function MyGearTransferList({
  items,
  workers,
}: {
  items: GearItem[];
  workers: WorkerOption[];
}) {
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <TransferRow key={item.id} item={item} workers={workers} />
      ))}
      {items.length === 0 ? (
        <div className="rounded-2xl border border-slate-700 bg-slate-900 p-5 text-center text-sm text-slate-300">
          You have no gear assigned right now.
        </div>
      ) : null}
    </div>
  );
}

function TransferRow({ item, workers }: { item: GearItem; workers: WorkerOption[] }) {
  const [selectedWorkerId, setSelectedWorkerId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [showCode, setShowCode] = useState(false);

  const transferLink = `${typeof window !== "undefined" ? window.location.origin : ""}/mobile/confirm/${encodeURIComponent(item.tagId)}?mode=out`;

  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-900 p-4 text-white">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-base font-bold tracking-tight">{item.name}</div>
          <div className="mt-1 text-xs font-mono text-slate-400">{item.tagId}</div>
          <div className="mt-1 text-xs text-slate-400">Location: {item.siteName ?? "Unknown site"}</div>
        </div>
        <button
          type="button"
          onClick={() => setShowCode((v) => !v)}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-semibold text-slate-200"
        >
          <QrCode className="h-4 w-4" />
          {showCode ? "Hide QR" : "Transfer QR"}
        </button>
      </div>

      {showCode ? (
        <div className="mt-3 rounded-xl border border-slate-700 bg-slate-950 p-3">
          <div className="grid h-32 place-items-center rounded-lg border border-dashed border-slate-700 bg-slate-900 text-center text-xs text-slate-400">
            QR placeholder
            <br />
            {transferLink}
          </div>
        </div>
      ) : null}

      <div className="mt-3 flex items-center gap-2">
        <select
          value={selectedWorkerId}
          onChange={(e) => setSelectedWorkerId(e.target.value)}
          className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-slate-400 focus:outline-none"
        >
          <option value="">Select worker to transfer to</option>
          {workers.map((worker) => (
            <option key={worker.id} value={worker.id}>
              {worker.fullName}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!selectedWorkerId || isPending}
          onClick={() =>
            startTransition(async () => {
              setMessage(null);
              const result = await transferAsset(item.tagId, selectedWorkerId);
              setMessage(result.success ? "Transfer requested" : result.error ?? "Transfer failed");
            })
          }
          className="inline-flex items-center gap-2 rounded-xl bg-sky-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          <SendHorizontal className="h-4 w-4" />
          Transfer
        </button>
      </div>

      {message ? (
        <div className="mt-2 text-xs text-slate-300">{message}</div>
      ) : null}
    </div>
  );
}

