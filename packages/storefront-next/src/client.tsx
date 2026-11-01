"use client";

import { visualEditingBridge } from "@spindlecommerce/storefront-client";
import { useRouter } from "next/navigation";
import Script from "next/script";
import { useEffect, useRef, useSyncExternalStore, useTransition } from "react";
import { CART_COUNT_COOKIE } from "./cookies.ts";

/**
 * Connects the page to the admin's editor when framed there. A saved draft re-renders through
 * router.refresh(); the bridge is told once the new content has committed. `localize` turns the
 * admin's paths, which have no language, into this page's.
 */
export function VisualEditing({ adminOrigin, bridgeUrl, localize }: { adminOrigin: string; bridgeUrl: string; localize?: (path: string) => string }) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const awaitingRender = useRef(false);

  useEffect(() => {
    // Runs after the refreshed server components have been committed to the DOM.
    if (refreshing || !awaitingRender.current) return;
    awaitingRender.current = false;
    visualEditingBridge()?.rendered();
  }, [refreshing]);

  const connect = () => {
    visualEditingBridge()?.init({
      adminOrigin,
      onRefresh: () => {
        awaitingRender.current = true;
        startTransition(() => router.refresh());
      },
      navigate: (path) => router.push(localize ? localize(path) : path),
    });
  };

  return <Script src={bridgeUrl} strategy="afterInteractive" onReady={connect} />;
}

const CART_CHANGED = "spindle:cart-changed";

const readCount = () => {
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${CART_COUNT_COOKIE}=(\\d+)`));
  return match ? Number(match[1]) : 0;
};

const subscribe = (onChange: () => void) => {
  window.addEventListener(CART_CHANGED, onChange);
  window.addEventListener("focus", onChange);
  return () => {
    window.removeEventListener(CART_CHANGED, onChange);
    window.removeEventListener("focus", onChange);
  };
};

/** After a cart change in this tab, so useCartCount reads the count again. */
export const notifyCartChanged = () => window.dispatchEvent(new Event(CART_CHANGED));

/** The cart's item count, read from a cookie in the browser so pages stay cacheable. 0 on the server. */
export const useCartCount = () => useSyncExternalStore(subscribe, readCount, () => 0);
