"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Pick up other people's replies and update an open invitation at its cutoff. */
export function InvitationRefresh({ deadline }: { deadline?: number }) {
  const router = useRouter();
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") router.refresh(); };
    let timer: ReturnType<typeof setTimeout>;
    function schedule() {
      const remaining = (deadline ?? 0) - Date.now();
      const delay = remaining > 0 ? Math.min(60_000, remaining + 100) : 60_000;
      timer = setTimeout(() => {
        refresh();
        schedule();
      }, delay);
    }
    schedule();
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router, deadline]);
  return null;
}
