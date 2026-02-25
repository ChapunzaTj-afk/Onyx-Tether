"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ScannerOverlay from "./ScannerOverlay";

type ScannerMode = "out" | "in";

type TransferQrPayload = {
  type: "onyx_transfer";
  assetId: string;
  fromUserId: string;
  tagId: string;
};

function parseTransferQrPayload(raw: string): TransferQrPayload | null {
  const text = raw.trim();
  const withoutPrefix = text.startsWith("ONYX_TETHER_TRANSFER:")
    ? text.slice("ONYX_TETHER_TRANSFER:".length)
    : text;

  try {
    const parsed = JSON.parse(withoutPrefix) as Partial<TransferQrPayload>;
    if (
      parsed.type === "onyx_transfer" &&
      typeof parsed.assetId === "string" &&
      typeof parsed.fromUserId === "string" &&
      typeof parsed.tagId === "string"
    ) {
      return parsed as TransferQrPayload;
    }
  } catch {
    // Non-transfer QR payloads are treated as tag IDs.
  }

  return null;
}

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

    const onSuccess = (scanValue: string) => {
      if (handledRef.current) return;
      handledRef.current = true;
      navigator.vibrate?.(200);
      const transferPayload = parseTransferQrPayload(scanValue);
      void cleanup().finally(() => {
        if (transferPayload) {
          const qs = new URLSearchParams({
            assetId: transferPayload.assetId,
            fromUserId: transferPayload.fromUserId,
            tagId: transferPayload.tagId,
            source: "scan",
          });
          router.push(`/mobile/transfer?${qs.toString()}`);
        } else {
          router.push(`/mobile/confirm/${encodeURIComponent(scanValue)}?mode=${mode}`);
        }
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
      <div id="onyx-scanner-camera" className="absolute inset-0 bg-black" />
      <ScannerOverlay
        mode={mode}
        onClose={onClose}
        cameraReady={cameraReady}
        nfcReady={nfcReady}
        error={error}
        cameraHostId="onyx-scanner-camera"
      />
    </div>
  );
}
