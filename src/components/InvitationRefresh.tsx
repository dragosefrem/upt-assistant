"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Pick up other people's replies and update an open invitation at its cutoff. */
export function InvitationRefresh({ deadline }: { deadline?: number }) {
  const router = useRouter();
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") router.refresh(); };
    const timer = setInterval(refresh, 60_000);
    const cutoff = deadline && deadline > Date.now() ? setTimeout(refresh, deadline - Date.now() + 100) : undefined;
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      clearTimeout(cutoff);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router, deadline]);
  return null;
}
