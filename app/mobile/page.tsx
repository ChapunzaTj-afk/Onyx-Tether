"use client";

import { useState } from "react";
import { ArrowRightLeft, Undo2 } from "lucide-react";
import UnifiedScanner from "../../components/UnifiedScanner";
import { SyncIndicator } from "../../lib/offline-sync";

type ScannerMode = "out" | "in";

export default function MobileLandingPage() {
  const [mode, setMode] = useState<ScannerMode | null>(null);

  return (
    <main className="h-screen overflow-hidden bg-slate-950 text-white">
      <SyncIndicator />
      <div className="grid h-[calc(100vh-0px)] grid-rows-[auto_1fr_1fr]">
        <header className="px-4 py-4">
          <p className="text-center text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
            Onyx Tether Mobile
          </p>
        </header>

        <button
          type="button"
          onClick={() => setMode("out")}
          className="mx-4 mb-2 flex min-h-0 items-center justify-center rounded-3xl border border-emerald-400/30 bg-emerald-600 text-center shadow-[inset_0_1px_0_rgba(255,255,255,.15)] active:scale-[0.995]"
        >
          <div className="space-y-2 px-6">
            <ArrowRightLeft className="mx-auto h-10 w-10 text-emerald-100" />
            <div className="text-3xl font-black tracking-tight text-white">SCAN OUT / TRANSFER</div>
            <div className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald-100">
              Site checkout or handoff
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setMode("in")}
          className="mx-4 mt-2 mb-4 flex min-h-0 items-center justify-center rounded-3xl border border-sky-400/30 bg-sky-600 text-center shadow-[inset_0_1px_0_rgba(255,255,255,.15)] active:scale-[0.995]"
        >
          <div className="space-y-2 px-6">
            <Undo2 className="mx-auto h-10 w-10 text-sky-100" />
            <div className="text-3xl font-black tracking-tight text-white">SCAN IN / RETURN</div>
            <div className="text-sm font-semibold uppercase tracking-[0.16em] text-sky-100">
              Return or damage report
            </div>
          </div>
        </button>
      </div>

      <UnifiedScanner open={mode !== null} mode={mode ?? "out"} onClose={() => setMode(null)} />
    </main>
  );
}

