"use client";

import { useEffect, useMemo, useState } from "react";
import { Boxes, CheckSquare, Square } from "lucide-react";

export type KitChildAsset = {
  id: string;
  name: string;
  tagId: string;
  status: string;
};

export default function KitDisplay({
  parentAssetName,
  children,
  onSelectionChange,
}: {
  parentAssetName: string;
  children: KitChildAsset[];
  onSelectionChange?: (selectedChildIds: string[]) => void;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>(() => children.map((c) => c.id));

  useEffect(() => {
    const next = children.map((c) => c.id);
    setSelectedIds(next);
    onSelectionChange?.(next);
  }, [children, onSelectionChange]);

  const selectedCount = selectedIds.length;
  const allSelected = selectedCount === children.length;

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const toggleAll = () => {
    const next = allSelected ? [] : children.map((c) => c.id);
    setSelectedIds(next);
    onSelectionChange?.(next);
  };

  const toggleOne = (id: string) => {
    const next = selectedSet.has(id)
      ? selectedIds.filter((value) => value !== id)
      : [...selectedIds, id];
    setSelectedIds(next);
    onSelectionChange?.(next);
  };

  if (children.length === 0) return null;

  return (
    <section className="mt-4 rounded-2xl border border-amber-300/20 bg-amber-400/10 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-amber-100">
            <Boxes className="h-4 w-4" />
            <h2 className="text-sm font-black uppercase tracking-[0.14em]">Kit Contents</h2>
          </div>
          <p className="mt-1 text-sm text-amber-50/90">
            <span className="font-semibold">{parentAssetName}</span> has {children.length} linked items.
            Select what is physically in hand before confirming.
          </p>
        </div>
        <button
          type="button"
          onClick={toggleAll}
          className="rounded-xl border border-amber-200/30 bg-black/20 px-3 py-2 text-xs font-semibold text-amber-50"
        >
          {allSelected ? "Clear All" : "Select All"}
        </button>
      </div>

      <div className="mt-3 space-y-2">
        {children.map((child) => {
          const checked = selectedSet.has(child.id);
          return (
            <label
              key={child.id}
              className="flex cursor-pointer items-start gap-3 rounded-xl border border-amber-200/15 bg-black/10 px-3 py-2"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggleOne(child.id)}
                className="sr-only"
              />
              <span className="mt-0.5 text-amber-100">
                {checked ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-white">{child.name}</span>
                <span className="block font-mono text-[11px] text-amber-100/80">{child.tagId}</span>
              </span>
              <span className="rounded-full bg-black/20 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-amber-100">
                {child.status.replaceAll("_", " ")}
              </span>
            </label>
          );
        })}
      </div>

      <p className="mt-3 text-xs text-amber-50/80">
        Selected: {selectedCount}/{children.length}
      </p>
    </section>
  );
}
