"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { sendPageview, viewportCategory } from "../lib/client";
import type { TrafficEvent } from "../types";

export function TrafficTrackerClient() {
  const pathname = usePathname();
  const lastRoute = useRef<TrafficEvent["route"] | null>(null);
  useEffect(() => {
    if (pathname !== "/" && pathname !== "/appeal") {
      lastRoute.current = null;
      return;
    }
    if (lastRoute.current === pathname) return;
    lastRoute.current = pathname;
    // This effect runs after navigation commits, never during Next prefetch.
    void sendPageview({ route: pathname, viewport: viewportCategory((query) => window.matchMedia(query)) });
  }, [pathname]);
  return null;
}
