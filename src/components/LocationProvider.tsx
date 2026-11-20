"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

export interface Position {
  lat: number;
  lng: number;
}

interface LocationState {
  position: Position | null;
  status: "idle" | "asking" | "on" | "denied" | "unsupported";
  /** Asks the browser for the position (must be called from a click). */
  enable: () => void;
  disable: () => void;
}

const LocationContext = createContext<LocationState>({
  position: null,
  status: "idle",
  enable: () => {},
  disable: () => {},
});

const PREF_KEY = "upt.location";

/**
 * Shares the browser's position with the calendar and the assistant once the student
 * opts in. The position stays in the page and is only sent with a directions request.
 */
export function LocationProvider({ children }: { children: React.ReactNode }) {
  const [position, setPosition] = useState<Position | null>(null);
  const [status, setStatus] = useState<LocationState["status"]>("idle");
  const watch = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (watch.current !== null) navigator.geolocation.clearWatch(watch.current);
    watch.current = null;
  }, []);

  const enable = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setStatus("unsupported");
      return;
    }
    stop();
    setStatus((s) => (s === "on" ? s : "asking"));
    watch.current = navigator.geolocation.watchPosition(
      (p) => {
        setPosition({ lat: p.coords.latitude, lng: p.coords.longitude });
        setStatus("on");
        try {
          localStorage.setItem(PREF_KEY, "on");
        } catch {}
      },
      (err) => {
        setPosition(null);
        setStatus(err.code === err.PERMISSION_DENIED ? "denied" : "idle");
      },
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 15_000 },
    );
  }, [stop]);

  const disable = useCallback(() => {
    stop();
    setPosition(null);
    setStatus("idle");
    try {
      localStorage.removeItem(PREF_KEY);
    } catch {}
  }, [stop]);

  useEffect(() => {
    // Resume only if the student turned it on before; never prompt unasked.
    let remembered = false;
    try {
      remembered = localStorage.getItem(PREF_KEY) === "on";
    } catch {}
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time restore of a stored preference
    if (remembered) enable();
    return stop;
  }, [enable, stop]);

  return <LocationContext value={{ position, status, enable, disable }}>{children}</LocationContext>;
}

export function useLocation() {
  return useContext(LocationContext);
}
