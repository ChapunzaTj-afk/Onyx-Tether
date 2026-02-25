"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { CheckCircle2, PackageCheck, Trash2 } from "lucide-react";
import { returnAsset } from "../../../app/actions/asset-actions";
import { enqueueOfflineAction, SyncIndicator } from "../../../lib/offline-sync";

type ScannedItem = {
  tagId: string;
  scannedAt: string;
  status: "pending" | "success" | "failed";
  error?: string;
};

const CAMERA_HOST_ID = "onyx-batch-return-camera";

function beep() {
  try {
    const Ctx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = 880;
    gain.gain.value = 0.04;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    window.setTimeout(() => {
      osc.stop();
      void ctx.close();
    }, 120);
  } catch {
    // vibration is the primary feedback path on mobile
  }
}

export default function BatchReturnPage() {
  const scannerRef = useRef<{ stop: () => Promise<void> } | null>(null);
  const seenCooldownRef = useRef<Map<string, number>>(new Map());
  const [cameraReady, setCameraReady] = useState(false);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [items, setItems] = useState<ScannedItem[]>([]);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        const scanner = new Html5Qrcode(CAMERA_HOST_ID);
        scannerRef.current = scanner;

        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 260, height: 260 } },
          (decoded) => {
            const tagId = decoded.trim();
            if (!tagId) return;

            const now = Date.now();
            const lastSeen = seenCooldownRef.current.get(tagId) ?? 0;
            if (now - lastSeen < 1200) return;
            seenCooldownRef.current.set(tagId, now);

            setItems((prev) => {
              if (prev.some((item) => item.tagId === tagId)) return prev;
              navigator.vibrate?.(120);
              beep();
              return [
                { tagId, scannedAt: new Date().toISOString(), status: "pending" },
                ...prev,
              ];
            });
          },
          () => {},
        );

        if (!cancelled) setCameraReady(true);
      } catch (err) {
        if (!cancelled) {
          setScannerError(err instanceof Error ? err.message : "Camera unavailable");
        }
      }
    })();

    return () => {
      cancelled = true;
      if (scannerRef.current) {
        void scannerRef.current.stop().catch(() => undefined);
      }
    };
  }, []);

  const pendingCount = useMemo(
    () => items.filter((item) => item.status === "pending").length,
    [items],
  );

  const submitAll = () => {
    startTransition(async () => {
      for (const item of items) {
        if (item.status !== "pending") continue;

        try {
          if (!navigator.onLine) {
            enqueueOfflineAction({
              action: "return",
              tagId: item.tagId,
              isDamaged: false,
              offlineTimestamp: item.scannedAt,
            });
            setItems((prev) =>
              prev.map((row) =>
                row.tagId === item.tagId ? { ...row, status: "success" } : row,
              ),
            );
            continue;
          }

          const result = await returnAsset(item.tagId, false);
          if (!result.success) {
            setItems((prev) =>
              prev.map((row) =>
                row.tagId === item.tagId
                  ? { ...row, status: "failed", error: result.error ?? "Return failed" }
                  : row,
              ),
            );
            continue;
          }

          setItems((prev) =>
            prev.map((row) =>
              row.tagId === item.tagId ? { ...row, status: "success" } : row,
            ),
          );
        } catch (err) {
          setItems((prev) =>
            prev.map((row) =>
              row.tagId === item.tagId
                ? {
                    ...row,
                    status: "failed",
                    error: err instanceof Error ? err.message : "Return failed",
                  }
                : row,
            ),
          );
        }
      }
    });
  };

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <SyncIndicator />
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 py-4">
        <div className="mb-3 flex items-center justify-between">
          <Link
            href="/mobile"
            className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-semibold text-slate-100"
          >
            Back
          </Link>
          <span className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-xs uppercase tracking-[0.16em] text-slate-300">
            Batch Return
          </span>
        </div>

        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <div className="flex items-center gap-2">
            <PackageCheck className="h-5 w-5 text-emerald-400" />
            <h1 className="text-xl font-black tracking-tight">4:30 PM Bucket Flow</h1>
          </div>
          <p className="mt-2 text-sm text-slate-300">
            Continuous scan mode. Every new QR adds to the pending return bucket.
          </p>
          <div className="mt-3 rounded-xl border border-amber-300/20 bg-amber-400/10 px-3 py-2 text-center text-lg font-black tracking-tight text-amber-100">
            {items.length} {items.length === 1 ? "item" : "items"} in bucket
          </div>
        </section>

        <div className="mt-3 relative h-56 overflow-hidden rounded-2xl border border-slate-800 bg-black">
          <div id={CAMERA_HOST_ID} className="absolute inset-0" />
          <div className="pointer-events-none absolute inset-0 grid place-items-center p-6">
            <div className="w-full max-w-[14rem] rounded-3xl border-2 border-white/75 shadow-[0_0_0_9999px_rgba(2,6,23,0.55)]">
              <div className="aspect-square w-full rounded-3xl" />
            </div>
          </div>
          <div className="absolute bottom-2 left-2 right-2 rounded-lg border border-slate-700 bg-slate-900/90 px-3 py-2 text-xs text-slate-300">
            {cameraReady ? "Scanner ready. Keep dropping items in front of the lens." : "Starting camera..."}
            {scannerError ? <div className="mt-1 text-rose-300">{scannerError}</div> : null}
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            disabled={isPending || pendingCount === 0}
            onClick={submitAll}
            className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-black tracking-tight text-white disabled:opacity-50"
          >
            <CheckCircle2 className="h-4 w-4" />
            Submit All ({pendingCount})
          </button>
          <button
            type="button"
            disabled={isPending || items.length === 0}
            onClick={() => setItems([])}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm font-semibold text-slate-100 disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" />
            Clear
          </button>
        </div>

        <section className="mt-3 flex-1 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
          <div className="max-h-[40vh] overflow-y-auto">
            <ul className="divide-y divide-slate-800">
              {items.map((item) => (
                <li key={item.tagId} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-mono text-sm text-white">{item.tagId}</div>
                      <div className="text-xs text-slate-400">
                        {new Date(item.scannedAt).toLocaleTimeString()}
                      </div>
                    </div>
                    <span
                      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${
                        item.status === "success"
                          ? "bg-emerald-500/20 text-emerald-200"
                          : item.status === "failed"
                            ? "bg-rose-500/20 text-rose-200"
                            : "bg-sky-500/20 text-sky-200"
                      }`}
                    >
                      {item.status}
                    </span>
                  </div>
                  {item.error ? <p className="mt-2 text-xs text-rose-300">{item.error}</p> : null}
                </li>
              ))}
              {items.length === 0 ? (
                <li className="px-4 py-8 text-center text-sm text-slate-400">
                  Start scanning returns. Each successful read adds a tool to the bucket.
                </li>
              ) : null}
            </ul>
          </div>
        </section>
      </div>
    </main>
  );
}
