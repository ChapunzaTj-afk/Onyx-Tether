"use client";

import { useEffect, useMemo, useState } from "react";
import { Camera, Flashlight, ScanLine, SmartphoneNfc, X, ZapOff } from "lucide-react";

type ScannerOverlayProps = {
  mode: "out" | "in";
  onClose: () => void;
  cameraReady: boolean;
  nfcReady: boolean;
  error: string | null;
  cameraHostId: string;
};

function getVideoTrackFromHost(cameraHostId: string): MediaStreamTrack | null {
  const host = document.getElementById(cameraHostId);
  const video = host?.querySelector("video") as HTMLVideoElement | null;
  const srcObject = video?.srcObject;
  if (!(srcObject instanceof MediaStream)) return null;
  return srcObject.getVideoTracks()[0] ?? null;
}

export default function ScannerOverlay({
  mode,
  onClose,
  cameraReady,
  nfcReady,
  error,
  cameraHostId,
}: ScannerOverlayProps) {
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchBusy, setTorchBusy] = useState(false);

  useEffect(() => {
    if (!cameraReady) {
      setTorchEnabled(false);
      setTorchSupported(false);
      return;
    }

    const timer = window.setInterval(() => {
      const track = getVideoTrackFromHost(cameraHostId);
      if (!track) return;
      const capabilities = (track as MediaStreamTrack & { getCapabilities?: () => unknown })
        .getCapabilities?.() as { torch?: boolean } | undefined;
      setTorchSupported(Boolean(capabilities?.torch));
      if (capabilities?.torch !== undefined) {
        window.clearInterval(timer);
      }
    }, 300);

    return () => window.clearInterval(timer);
  }, [cameraHostId, cameraReady]);

  const torchLabel = useMemo(() => {
    if (!cameraReady) return "Camera starting";
    if (!torchSupported) return "No torch support";
    return torchEnabled ? "Flashlight on" : "Flashlight off";
  }, [cameraReady, torchEnabled, torchSupported]);

  const toggleTorch = async () => {
    if (!torchSupported || torchBusy) return;
    const track = getVideoTrackFromHost(cameraHostId);
    if (!track) return;

    setTorchBusy(true);
    try {
      await track.applyConstraints({
        advanced: [{ torch: !torchEnabled } as MediaTrackConstraintSet],
      });
      setTorchEnabled((v) => !v);
    } catch (err) {
      console.warn("Torch toggle failed", err);
    } finally {
      setTorchBusy(false);
    }
  };

  return (
    <div className="pointer-events-none fixed inset-0 z-[101] text-white">
      <div className="flex h-full flex-col">
        <div className="pointer-events-auto flex items-center justify-between border-b border-slate-800 bg-slate-950/85 px-4 py-3 backdrop-blur">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              {mode === "out" ? "Scan Out / Transfer" : "Scan In / Return"}
            </p>
            <p className="mt-1 text-sm text-slate-200">QR camera + NFC listening active</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleTorch}
              disabled={!torchSupported || torchBusy}
              className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold ${
                torchEnabled
                  ? "border-amber-300/60 bg-amber-400/20 text-amber-100"
                  : "border-slate-700 bg-slate-900 text-slate-200"
              } disabled:opacity-50`}
            >
              {torchEnabled ? <ZapOff className="h-4 w-4" /> : <Flashlight className="h-4 w-4" />}
              Flashlight
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-700 bg-slate-900 p-2 text-slate-200"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="relative flex-1">
          <div className="pointer-events-none absolute inset-0 grid place-items-center p-6">
            <div className="w-full max-w-sm rounded-3xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(2,6,23,0.58)]">
              <div className="aspect-square w-full rounded-3xl" />
            </div>
          </div>

          <div className="pointer-events-none absolute inset-x-4 top-4 rounded-xl border border-slate-700 bg-slate-900/90 px-3 py-2 text-xs text-slate-300">
            <div className="flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-2">
                <Flashlight className="h-4 w-4 text-amber-300" />
                {torchLabel}
              </span>
              {torchSupported ? (
                <span className="text-amber-200">{torchEnabled ? "HIGH VIS" : "Tap to enable"}</span>
              ) : null}
            </div>
          </div>

          <div className="pointer-events-none absolute bottom-4 left-4 right-4 space-y-2">
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
