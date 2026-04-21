"use client";
import { useEffect } from "react";
import { useFormatStore } from "@/lib/store";
import { useTemplateStore } from "@/lib/templateStore";
import { useRunStore } from "@/lib/runStore";

export function StoreHydrator({ children }: { children: React.ReactNode }) {
  const fetchFormats = useFormatStore((s) => s.fetchFormats);
  const fetchTemplates = useTemplateStore((s) => s.fetchTemplates);
  const loadRuns = useRunStore((s) => s.loadAll);

  useEffect(() => {
    fetchFormats();
    fetchTemplates();
    loadRuns();
  }, [fetchFormats, fetchTemplates, loadRuns]);

  return <>{children}</>;
}
