"use client";

import { useEffect, useState } from "react";

export type OfflineQueueAction =
  | {
      action: "checkout";
      tagId: string;
      siteId: string;
      offlineTimestamp: string;
      lat?: number;
      lng?: number;
      accuracy?: number;
    }
  | {
      action: "return";
      tagId: string;
      isDamaged?: boolean;
      photoUrl?: string;
      notes?: string;
      offlineTimestamp: string;
      lat?: number;
      lng?: number;
      accuracy?: number;
    }
  | {
      action: "transfer";
      tagId: string;
      targetUserId: string;
      offlineTimestamp: string;
      lat?: number;
      lng?: number;
      accuracy?: number;
    };

const STORAGE_KEY = "onyx_tether_offline_queue_v1";

export function readOfflineQueue(): OfflineQueueAction[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as OfflineQueueAction[]) : [];
  } catch {
    return [];
  }
}

function writeOfflineQueue(queue: OfflineQueueAction[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
}

export function enqueueOfflineAction(action: OfflineQueueAction) {
  const queue = readOfflineQueue();
  queue.push(action);
  writeOfflineQueue(queue);
}

export async function flushOfflineQueue(): Promise<{ processed: number; failed: number }> {
  const queue = readOfflineQueue();
  if (queue.length === 0) return { processed: 0, failed: 0 };

  const response = await fetch("/api/sync/offline", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(queue),
  });

  if (!response.ok) {
    throw new Error(`Offline sync failed with status ${response.status}`);
  }

  const result = (await response.json()) as {
    success: boolean;
    results?: Array<{ success: boolean }>;
  };

  const failures = (result.results ?? []).filter((item) => !item.success).length;

  if (failures === 0) {
    writeOfflineQueue([]);
  } else {
    const successfulIndexes = new Set(
      (result.results ?? [])
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => item.success)
        .map(({ index }) => index),
    );
    writeOfflineQueue(queue.filter((_, index) => !successfulIndexes.has(index)));
  }

  return { processed: queue.length, failed: failures };
}

export function useOfflineSync() {
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    setPendingCount(readOfflineQueue().length);
  }, []);

  useEffect(() => {
    const syncNow = async () => {
      const queue = readOfflineQueue();
      if (queue.length === 0 || !navigator.onLine) {
        setPendingCount(queue.length);
        return;
      }

      setIsSyncing(true);
      try {
        const result = await flushOfflineQueue();
        setPendingCount(Math.max(0, readOfflineQueue().length));
        if (result.failed > 0) {
          console.warn("Offline sync completed with failures", result);
        }
      } catch (error) {
        console.warn("Offline sync error", error);
        setPendingCount(readOfflineQueue().length);
      } finally {
        setIsSyncing(false);
      }
    };

    const onOnline = () => {
      void syncNow();
    };

    window.addEventListener("online", onOnline);
    void syncNow();

    return () => {
      window.removeEventListener("online", onOnline);
    };
  }, []);

  return {
    pendingCount,
    isSyncing,
    enqueue: (action: OfflineQueueAction) => {
      enqueueOfflineAction(action);
      setPendingCount(readOfflineQueue().length);
    },
    flush: async () => {
      setIsSyncing(true);
      try {
        const result = await flushOfflineQueue();
        setPendingCount(readOfflineQueue().length);
        return result;
      } finally {
        setIsSyncing(false);
      }
    },
  };
}

export function SyncIndicator() {
  const { pendingCount, isSyncing } = useOfflineSync();

  if (pendingCount === 0 && !isSyncing) return null;

  return (
    <div className="sticky top-0 z-50 w-full border-b border-amber-300 bg-amber-400 px-4 py-2 text-center text-xs font-semibold uppercase tracking-[0.16em] text-slate-900">
      {isSyncing ? "Syncing Offline Actions..." : `${pendingCount} Offline Action${pendingCount === 1 ? "" : "s"} Waiting`}
    </div>
  );
}

