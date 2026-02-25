"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, CheckCircle2, AlertTriangle, ArrowLeft, Upload } from "lucide-react";
import { createClient } from "@supabase/supabase-js";
import { checkoutAsset, returnAsset } from "../app/actions/asset-actions";
import { enqueueOfflineAction, SyncIndicator } from "../lib/offline-sync";

type SiteOption = { id: string; name: string };
type AssetSummary = { id: string; name: string; tagId: string; status: string };

export default function MobileConfirmClient({
  mode,
  tagId,
  asset,
  sites,
}: {
  mode: "out" | "in";
  tagId: string;
  asset: AssetSummary | null;
  sites: SiteOption[];
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [damagePhotoFile, setDamagePhotoFile] = useState<File | null>(null);
  const [damageNotes, setDamageNotes] = useState("");

  const title = asset?.name ?? `Tag ${tagId}`;
  const activeSites = useMemo(() => sites.filter((s) => s.name.toLowerCase() !== "yard"), [sites]);

  const getGeo = async () =>
    new Promise<{ lat?: number; lng?: number; accuracy?: number }>((resolve) => {
      if (!navigator.geolocation) return resolve({});
      navigator.geolocation.getCurrentPosition(
        (pos) =>
          resolve({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          }),
        () => resolve({}),
        { enableHighAccuracy: true, timeout: 4000, maximumAge: 5000 },
      );
    });

  const queueAndExit = async (
    action:
      | { action: "checkout"; siteId: string }
      | { action: "return"; isDamaged: boolean; photoUrl?: string; notes?: string },
  ) => {
    const geo = await getGeo();
    const offlineTimestamp = new Date().toISOString();

    if (action.action === "checkout") {
      enqueueOfflineAction({ action: "checkout", tagId, siteId: action.siteId, offlineTimestamp, ...geo });
    } else {
      enqueueOfflineAction({
        action: "return",
        tagId,
        isDamaged: action.isDamaged,
        photoUrl: action.photoUrl,
        notes: action.notes,
        offlineTimestamp,
        ...geo,
      });
    }

    router.push("/mobile");
  };

  const uploadDamagePhoto = async () => {
    if (!damagePhotoFile) return undefined;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error("Supabase browser credentials missing");

    const supabase = createClient(url, key);
    const filePath = `mobile-damage/${Date.now()}-${tagId}-${damagePhotoFile.name}`;
    const { error: uploadError } = await supabase.storage
      .from("damage_photos")
      .upload(filePath, damagePhotoFile, { upsert: false });
    if (uploadError) throw new Error(uploadError.message);

    const { data } = supabase.storage.from("damage_photos").getPublicUrl(filePath);
    return data.publicUrl;
  };

  const handleCheckout = (siteId: string) => {
    setError(null);
    startTransition(async () => {
      try {
        if (!navigator.onLine) {
          await queueAndExit({ action: "checkout", siteId });
          return;
        }

        const geo = await getGeo();
        const result = await checkoutAsset(tagId, siteId, geo.lat, geo.lng, geo.accuracy);
        if (!result.success) {
          setError(result.error ?? "Checkout failed");
          return;
        }
        router.push("/mobile");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Checkout failed");
      }
    });
  };

  const handleReturn = (isDamaged: boolean) => {
    setError(null);
    startTransition(async () => {
      try {
        let photoUrl: string | undefined;
        if (isDamaged) {
          if (!damagePhotoFile) {
            setError("Damage photo required before submitting a damaged return.");
            return;
          }
          photoUrl = await uploadDamagePhoto();
        }

        if (!navigator.onLine) {
          await queueAndExit({
            action: "return",
            isDamaged,
            photoUrl,
            notes: damageNotes || undefined,
          });
          return;
        }

        const geo = await getGeo();
        const result = await returnAsset(
          tagId,
          isDamaged,
          photoUrl,
          damageNotes || undefined,
          geo.lat,
          geo.lng,
          geo.accuracy,
        );
        if (!result.success) {
          setError(result.error ?? "Return failed");
          return;
        }
        router.push("/mobile");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Return failed");
      }
    });
  };

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <SyncIndicator />
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 py-4">
        <div className="mb-4 flex items-center justify-between">
          <button
            type="button"
            onClick={() => router.push("/mobile")}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-medium text-slate-100"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
          <span className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-xs uppercase tracking-[0.16em] text-slate-300">
            {mode === "out" ? "Scan Out / Transfer" : "Scan In / Return"}
          </span>
        </div>

        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-sm">
          <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Asset</p>
          <h1 className="mt-2 text-2xl font-black tracking-tight text-white">{title}</h1>
          <p className="mt-1 font-mono text-xs text-slate-400">{tagId}</p>
        </section>

        {error ? (
          <div className="mt-4 rounded-xl border border-rose-300/50 bg-rose-500/15 px-4 py-3 text-sm text-rose-200">
            {error}
          </div>
        ) : null}

        {mode === "out" ? (
          <section className="mt-4 flex-1 space-y-3">
            <p className="px-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
              Choose Site
            </p>
            <div className="grid gap-3">
              {activeSites.map((site) => (
                <button
                  key={site.id}
                  type="button"
                  disabled={isPending}
                  onClick={() => handleCheckout(site.id)}
                  className="min-h-16 rounded-2xl border border-emerald-400/20 bg-emerald-600 px-4 py-4 text-left text-white active:scale-[0.995] disabled:opacity-60"
                >
                  <div className="text-lg font-black tracking-tight">{site.name}</div>
                  <div className="mt-1 text-xs uppercase tracking-[0.16em] text-emerald-100">
                    Tap to assign
                  </div>
                </button>
              ))}
            </div>
          </section>
        ) : (
          <section className="mt-4 flex-1 space-y-4">
            <div className="grid gap-3">
              <button
                type="button"
                disabled={isPending}
                onClick={() => handleReturn(false)}
                className="min-h-24 rounded-2xl border border-emerald-400/20 bg-emerald-600 px-4 py-4 text-center text-white active:scale-[0.995] disabled:opacity-60"
              >
                <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-100" />
                <div className="mt-2 text-2xl font-black tracking-tight">ALL GOOD</div>
              </button>

              <div className="rounded-2xl border border-rose-400/20 bg-rose-600/15 p-4">
                <div className="flex items-center gap-2 text-rose-100">
                  <AlertTriangle className="h-5 w-5" />
                  <h2 className="text-lg font-black tracking-tight">DAMAGED</h2>
                </div>

                <p className="mt-2 text-sm text-rose-100/90">
                  Damage photo is required before submission.
                </p>

                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(e) => setDamagePhotoFile(e.target.files?.[0] ?? null)}
                  className="hidden"
                />

                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-rose-300/40 bg-rose-500/20 px-4 py-3 text-sm font-semibold text-rose-50"
                >
                  <Camera className="h-4 w-4" />
                  {damagePhotoFile ? "Replace Damage Photo" : "Take Damage Photo"}
                </button>

                {damagePhotoFile ? (
                  <div className="mt-2 rounded-lg border border-rose-300/20 bg-black/20 px-3 py-2 text-xs text-rose-100">
                    <div className="flex items-center gap-2">
                      <Upload className="h-3.5 w-3.5" />
                      {damagePhotoFile.name}
                    </div>
                  </div>
                ) : null}

                <textarea
                  value={damageNotes}
                  onChange={(e) => setDamageNotes(e.target.value)}
                  rows={3}
                  placeholder="What happened?"
                  className="mt-3 w-full rounded-xl border border-rose-300/30 bg-black/20 px-3 py-2.5 text-sm text-white placeholder:text-rose-100/60 focus:border-rose-200 focus:outline-none"
                />

                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => handleReturn(true)}
                  className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
                >
                  <AlertTriangle className="h-4 w-4" />
                  Submit Damaged Return
                </button>
              </div>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

