"use client";

import type { InputHTMLAttributes } from "react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, PackagePlus, Radio, ScanLine, Warehouse } from "lucide-react";
import { registerAsset } from "../app/actions/admin-asset-actions";

type Props = {
  triggerLabel?: string;
};

export default function AddAssetSlideOver({ triggerLabel = "Add New Asset" }: Props) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isBulk, setIsBulk] = useState(false);
  const [assetName, setAssetName] = useState("");
  const [tagId, setTagId] = useState("");
  const [purchaseValue, setPurchaseValue] = useState("");
  const [nextServiceDate, setNextServiceDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleScanTag = async () => {
    try {
      if (typeof window === "undefined") return;

      if (typeof navigator !== "undefined" && "mediaDevices" in navigator) {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        stream.getTracks().forEach((track) => track.stop());
      }

      window.alert(
        "Camera/NFC scan hook opened. Connect your QR/NFC scanner integration here to auto-fill the Tag ID.",
      );
    } catch {
      window.alert("Unable to access camera/NFC on this device. Enter the tag ID manually.");
    }
  };

  const handleSubmit = (formData: FormData) => {
    setError(null);

    const name = String(formData.get("asset_name") ?? "").trim();
    const tag = String(formData.get("tag_id") ?? "").trim();
    const value = Number(formData.get("purchase_value") ?? 0);
    const serviceDate = String(formData.get("next_service_date") ?? "").trim();

    startTransition(async () => {
      const result = await registerAsset(tag, name, value, serviceDate || undefined);

      if (!result.success) {
        setError(result.error ?? "Failed to register asset.");
        return;
      }

      setAssetName("");
      setTagId("");
      setPurchaseValue("");
      setNextServiceDate("");
      setIsBulk(false);
      setIsOpen(false);
      router.refresh();
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
      >
        <PackagePlus className="h-4 w-4" />
        {triggerLabel}
      </button>

      {isOpen ? (
        <div className="fixed inset-0 z-50 bg-slate-950/55 backdrop-blur-sm">
          <div className="absolute inset-y-0 right-0 w-full max-w-xl border-l border-slate-200 bg-white shadow-2xl">
            <div className="flex h-full flex-col">
              <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Hardware Pairing
                  </p>
                  <h2 className="mt-1 text-lg font-semibold text-slate-900">Register New Gear</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
                >
                  Close
                </button>
              </div>

              <form action={handleSubmit} className="flex min-h-0 flex-1 flex-col">
                <div className="space-y-6 overflow-y-auto px-6 py-5">
                  <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                      Asset Type
                    </p>
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => setIsBulk(false)}
                        className={[
                          "rounded-xl border px-4 py-3 text-left transition",
                          !isBulk
                            ? "border-slate-900 bg-slate-900 text-white"
                            : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                        ].join(" ")}
                      >
                        <Warehouse className="mb-2 h-4 w-4" />
                        <p className="text-sm font-semibold">Single Item</p>
                        <p className="mt-1 text-xs opacity-80">Serialized tool or machine</p>
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsBulk(true)}
                        className={[
                          "rounded-xl border px-4 py-3 text-left transition",
                          isBulk
                            ? "border-slate-900 bg-slate-900 text-white"
                            : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                        ].join(" ")}
                      >
                        <Radio className="mb-2 h-4 w-4" />
                        <p className="text-sm font-semibold">Bulk Material</p>
                        <p className="mt-1 text-xs opacity-80">Sand, fixings, consumables</p>
                      </button>
                    </div>
                    <p className="mt-3 text-xs text-slate-500">
                      UI supports bulk setup. The current `registerAsset` action registers the base asset row;
                      quantity distribution can be configured after creation.
                    </p>
                  </section>

                  <InputField
                    label="Asset Name"
                    name="asset_name"
                    value={assetName}
                    onChange={setAssetName}
                    placeholder={isBulk ? "Type 1 Sub-base Aggregate" : "Makita Breaker 04"}
                  />

                  <div className="space-y-1.5">
                    <label className="block text-sm font-medium text-slate-700">Tag ID</label>
                    <div className="flex gap-2">
                      <input
                        name="tag_id"
                        value={tagId}
                        onChange={(e) => setTagId(e.target.value)}
                        placeholder="ONYX-QR-000184"
                        className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none"
                        required
                      />
                      <button
                        type="button"
                        onClick={handleScanTag}
                        className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                      >
                        <ScanLine className="h-4 w-4" />
                        <span className="hidden sm:inline">Scan Tag</span>
                        <Camera className="h-4 w-4 sm:hidden" />
                      </button>
                    </div>
                  </div>

                  <InputField
                    label="Purchase Value"
                    name="purchase_value"
                    type="number"
                    value={purchaseValue}
                    onChange={setPurchaseValue}
                    placeholder="850"
                    step="0.01"
                    min="0"
                  />

                  <InputField
                    label="Next Service Date"
                    name="next_service_date"
                    type="date"
                    value={nextServiceDate}
                    onChange={setNextServiceDate}
                    placeholder=""
                  />

                  {error ? (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                      {error}
                    </div>
                  ) : null}
                </div>

                <div className="border-t border-slate-200 px-6 py-4">
                  <button
                    type="submit"
                    disabled={isPending}
                    className="w-full rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-emerald-300"
                  >
                    {isPending ? "Registering..." : "Register Asset"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function InputField({
  label,
  name,
  value,
  onChange,
  placeholder,
  type = "text",
  ...rest
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  type?: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "name" | "value" | "onChange" | "type">) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <input
        name={name}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none"
        {...rest}
      />
    </label>
  );
}
