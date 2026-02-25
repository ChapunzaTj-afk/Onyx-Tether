"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, ScanLine, SmartphoneNfc, X } from "lucide-react";

type ScannerMode = "out" | "in";

export default function UnifiedScanner({
  open,
  mode,
  onClose,
}: {
  open: boolean;
  mode: ScannerMode;
  onClose: () => void;
}) {
  const router = useRouter();
  const scannerRef = useRef<{ stop: () => Promise<void> } | null>(null);
  const readerAbortRef = useRef<AbortController | null>(null);
  const handledRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [nfcReady, setNfcReady] = useState(false);

  useEffect(() => {
    if (!open) return;

    handledRef.current = false;
    setError(null);
    setCameraReady(false);
    setNfcReady(false);

    const onSuccess = (rawTag: string) => {
      if (handledRef.current) return;
      handledRef.current = true;
      navigator.vibrate?.(200);
      void cleanup().finally(() => {
        router.push(`/mobile/confirm/${encodeURIComponent(rawTag)}?mode=${mode}`);
        onClose();
      });
    };

    const startCameraScanner = async () => {
      try {
        const [{ Html5Qrcode }] = await Promise.all([import("html5-qrcode")]);
        const scanner = new Html5Qrcode("onyx-scanner-camera");
        scannerRef.current = scanner;

        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 260, height: 260 } },
          (decodedText) => onSuccess(decodedText.trim()),
          () => {},
        );
        setCameraReady(true);
      } catch (cameraError) {
        setError(
          cameraError instanceof Error
            ? `Camera unavailable: ${cameraError.message}`
            : "Camera unavailable",
        );
      }
    };

    const startNfcReader = async () => {
      try {
        if (!("NDEFReader" in window)) return;
        const abort = new AbortController();
        readerAbortRef.current = abort;

        // @ts-expect-error Web NFC not in TS DOM lib by default
        const reader = new NDEFReader();
        // @ts-expect-error Web NFC typing gap
        await reader.scan({ signal: abort.signal });
        setNfcReady(true);

        // @ts-expect-error Web NFC typing gap
        reader.addEventListener("reading", (event) => {
          // @ts-expect-error Web NFC typing gap
          const records = event.message?.records ?? [];
          for (const record of records) {
            try {
              if (record.recordType === "text" && record.data) {
                const textDecoder = new TextDecoder(record.encoding || "utf-8");
                const text = textDecoder.decode(record.data).trim();
                if (text) {
                  onSuccess(text);
                  break;
                }
              }
            } catch {
              continue;
            }
          }
        });
      } catch {
        // Silent fallback; camera remains primary scan path.
      }
    };

    void Promise.all([startCameraScanner(), startNfcReader()]);

    const cleanup = async () => {
      if (readerAbortRef.current) {
        readerAbortRef.current.abort();
        readerAbortRef.current = null;
      }
      if (scannerRef.current) {
        try {
          await scannerRef.current.stop();
        } catch {
          // ignore
        } finally {
          scannerRef.current = null;
        }
      }
    };

    return () => {
      void cleanup();
    };
  }, [mode, onClose, open, router]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-slate-950 text-white">
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              {mode === "out" ? "Scan Out / Transfer" : "Scan In / Return"}
            </p>
            <p className="mt-1 text-sm text-slate-200">QR camera + NFC listening active</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-700 bg-slate-900 p-2 text-slate-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="relative flex-1">
          <div id="onyx-scanner-camera" className="absolute inset-0 bg-black" />

          <div className="pointer-events-none absolute inset-0 grid place-items-center p-6">
            <div className="w-full max-w-sm rounded-3xl border-2 border-white/70 shadow-[0_0_0_9999px_rgba(2,6,23,0.58)]">
              <div className="aspect-square w-full rounded-3xl" />
            </div>
          </div>

          <div className="absolute bottom-4 left-4 right-4 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-slate-700 bg-slate-900/90 px-3 py-2 text-xs text-slate-200">
                <div className="mb-1 flex items-center gap-2">
                  <Camera className="h-4 w-4 text-emerald-400" />
                  Camera
                </div>
                <div className={cameraReady ? "text-emerald-300" : "text-slate-400"}>
                  {cameraReady ? "Ready" : "Starting..."}
                </div>
              </div>
              <div className="rounded-xl border border-slate-700 bg-slate-900/90 px-3 py-2 text-xs text-slate-200">
                <div className="mb-1 flex items-center gap-2">
                  <SmartphoneNfc className="h-4 w-4 text-sky-400" />
                  NFC
                </div>
                <div className={nfcReady ? "text-sky-300" : "text-slate-400"}>
                  {nfcReady ? "Listening" : "Optional / Unsupported"}
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-700 bg-slate-900/90 px-3 py-2 text-xs text-slate-300">
              <div className="flex items-center gap-2">
                <ScanLine className="h-4 w-4 text-amber-400" />
                Point camera at QR code or tap NFC tag.
              </div>
              {error ? <div className="mt-2 text-rose-300">{error}</div> : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

