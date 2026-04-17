"use client";
import { useEffect } from "react";
import { useFormatStore } from "@/lib/store";
import { useTemplateStore } from "@/lib/templateStore";

export function StoreHydrator({ children }: { children: React.ReactNode }) {
  const fetchFormats = useFormatStore((s) => s.fetchFormats);
  const fetchTemplates = useTemplateStore((s) => s.fetchTemplates);

  useEffect(() => {
    fetchFormats();
    fetchTemplates();
  }, [fetchFormats, fetchTemplates]);

  return <>{children}</>;
}
