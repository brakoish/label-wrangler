"use client";
import { useEffect } from "react";
import { useFormatStore } from "@/lib/store";
import { useTemplateStore } from "@/lib/templateStore";
import { useRunStore } from "@/lib/runStore";
import { flushOfflineQueue } from "@/lib/offlineQueue";

/**
 * App-level bootstrap: hydrates the in-memory stores from the API on mount
 * and flushes any queued offline run updates (progress writes that were
 * lost during a previous network flap). Also listens for `window.online`
 * so returning from an offline pocket triggers a fresh flush + refetch.
 */
export function StoreHydrator({ children }: { children: React.ReactNode }) {
  const fetchFormats = useFormatStore((s) => s.fetchFormats);
  const fetchTemplates = useTemplateStore((s) => s.fetchTemplates);
  const loadRuns = useRunStore((s) => s.loadAll);

  useEffect(() => {
    fetchFormats();
    fetchTemplates();
    loadRuns();
    // Replay any pending progress patches from a previous session.
    void flushOfflineQueue().then((r) => {
      if (r.flushed > 0) {
        // Pick up server-side state post-flush so the UI reflects any
        // corrections the flush produced.
        void loadRuns();
      }
    });
    const onOnline = () => {
      void flushOfflineQueue().then((r) => {
        if (r.flushed > 0) void loadRuns();
      });
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [fetchFormats, fetchTemplates, loadRuns]);

  return <>{children}</>;
}
