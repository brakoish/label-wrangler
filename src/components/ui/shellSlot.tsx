'use client';

import { useEffect, useSyncExternalStore } from 'react';

/**
 * Lets app-wide banners (sync and load errors from StoreHydrator) render
 * inside the page layout under the header when a page uses AppShell, and
 * fall back to the top of the page when it doesn't.
 */
let shells = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function useShellMounted(): boolean {
  return useSyncExternalStore(subscribe, () => shells > 0, () => false);
}

export function useRegisterShell() {
  useEffect(() => {
    shells += 1; emit();
    return () => { shells -= 1; emit(); };
  }, []);
}

let bannerNode: React.ReactNode = null;
const bannerListeners = new Set<() => void>();
export function setShellBanners(node: React.ReactNode) { bannerNode = node; bannerListeners.forEach((listener) => listener()); }
export function useShellBanners(): React.ReactNode {
  return useSyncExternalStore((listener) => { bannerListeners.add(listener); return () => { bannerListeners.delete(listener); }; }, () => bannerNode, () => null);
}
