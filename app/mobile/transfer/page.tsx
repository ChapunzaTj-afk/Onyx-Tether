"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeftRight, CheckCircle2, QrCode, ScanLine } from "lucide-react";
import { createClient } from "@supabase/supabase-js";
import { acceptTransfer } from "../../../app/actions/asset-actions";

type TransferQrPayload = {
  type: "onyx_transfer";
  assetId: string;
  fromUserId: string;
  tagId: string;
};

type AssetRow = { id: string; name: string; tag_id: string; status: string };

export default function MobileTransferPage() {
  const qs = useSearchParams();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [asset, setAsset] = useState<AssetRow | null>(null);
  const [loading, setLoading] = useState(true);

  const assetId = qs.get("assetId");
  const tagId = qs.get("tagId");
  const source = qs.get("source");

  const isTakerConfirm = source === "scan" && Boolean(tagId);

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) {
      setError("Supabase browser credentials missing");
      setLoading(false);
      return;
    }

    const supabase = createClient(url, key);

    void (async () => {
      try {
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        if (userError || !user) {
          setError("Sign in required.");
          return;
        }

        setUserId(user.id);

        if (assetId) {
          const { data, error: assetError } = await supabase
            .from("assets")
            .select("id, name, tag_id, status")
            .eq("id", assetId)
            .single<AssetRow>();

          if (assetError) {
            throw new Error(assetError.message);
          }

          setAsset(data);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load transfer details");
      } finally {
        setLoading(false);
      }
    })();
  }, [assetId]);

  const payload = useMemo<TransferQrPayload | null>(() => {
    if (!asset || !userId) return null;
    return {
      type: "onyx_transfer",
      assetId: asset.id,
      fromUserId: userId,
      tagId: asset.tag_id,
    };
  }, [asset, userId]);

  const qrValue = payload ? `ONYX_TETHER_TRANSFER:${JSON.stringify(payload)}` : null;
  const qrImageUrl = qrValue
    ? `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(qrValue)}`
    : null;

  const handleAccept = () => {
    if (!tagId) return;
    setError(null);
    startTransition(async () => {
      const result = await acceptTransfer(tagId);
      if (!result.success) {
        setError(result.error ?? "Transfer acceptance failed");
        return;
      }
      router.push("/mobile/my-gear");
    });
  };

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 py-4">
        <div className="mb-4 flex items-center justify-between">
          <Link
            href="/mobile/my-gear"
            className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-semibold text-slate-100"
          >
            Back
          </Link>
          <span className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-xs uppercase tracking-[0.16em] text-slate-300">
            Tool Hand-off
          </span>
        </div>

        {loading ? (
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 text-sm text-slate-300">
            Loading transfer details...
          </div>
        ) : null}

        {error ? (
          <div className="mb-4 rounded-xl border border-rose-300/40 bg-rose-500/15 px-4 py-3 text-sm text-rose-200">
            {error}
          </div>
        ) : null}

        {isTakerConfirm ? (
          <section className="rounded-2xl border border-sky-400/20 bg-slate-900 p-5">
            <div className="flex items-center gap-2 text-sky-200">
              <ArrowLeftRight className="h-5 w-5" />
              <h1 className="text-xl font-black tracking-tight">Confirm Accept</h1>
            </div>
            <p className="mt-3 text-sm text-slate-300">
              You scanned a transfer hand-off QR. Confirm receipt to accept the tool into your name.
            </p>
            {tagId ? (
              <div className="mt-3 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-300">
                Tag: {tagId}
              </div>
            ) : null}
            <button
              type="button"
              disabled={isPending || !tagId}
              onClick={handleAccept}
              className="mt-4 inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-4 text-base font-black tracking-tight text-white disabled:opacity-60"
            >
              <CheckCircle2 className="h-5 w-5" />
              Confirm Accept Transfer
            </button>
          </section>
        ) : (
          <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <div className="flex items-center gap-2 text-emerald-200">
              <QrCode className="h-5 w-5" />
              <h1 className="text-xl font-black tracking-tight">Transfer QR</h1>
            </div>
            <p className="mt-3 text-sm text-slate-300">
              Show this code to the receiving worker. They can scan it from the home screen to jump straight to the accept screen.
            </p>

            {asset ? (
              <div className="mt-4 rounded-xl border border-slate-700 bg-slate-950 p-3">
                <div className="text-sm font-bold text-white">{asset.name}</div>
                <div className="mt-1 font-mono text-xs text-slate-400">{asset.tag_id}</div>
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-amber-300/20 bg-amber-400/10 px-3 py-2 text-sm text-amber-100">
                Open this page from <span className="font-semibold">My Gear</span> to generate a hand-off QR.
              </div>
            )}

            {qrImageUrl ? (
              <div className="mt-4 rounded-2xl border border-slate-700 bg-white p-4">
                {/* External QR image keeps this page dependency-free. */}
                <img src={qrImageUrl} alt="Transfer QR code" className="mx-auto h-64 w-64" />
              </div>
            ) : null}

            {qrValue ? (
              <details className="mt-3 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2">
                <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.16em] text-slate-300">
                  Payload
                </summary>
                <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all text-[11px] text-slate-400">
                  {qrValue}
                </pre>
              </details>
            ) : null}

            <Link
              href="/mobile"
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm font-semibold text-slate-100"
            >
              <ScanLine className="h-4 w-4" />
              Back to Scanner
            </Link>
          </section>
        )}
      </div>
    </main>
  );
}
