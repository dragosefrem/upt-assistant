"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/i18n/client";
import { routeEntrance, routeGoal, type CampusLink } from "@/lib/campuspath/links";
import type { Route } from "@/lib/campuspath/types";
import { reveal, routeFloor } from "./format";
import { GetThere } from "./GetThere";
import { RouteView, type RouteKind } from "./RouteView";

/**
 * A walk shown as one trip: who it is for, then leg 1 (to the building entrance, on a map)
 * and leg 2 (inside, on the walkthrough). The example and walks that start indoors are leg 2 alone.
 */
export function Journey({
  route,
  kind,
  context,
  mapsKey,
  onRetry,
  onShare,
  onCopy,
  copied,
  onStartElsewhere,
}: {
  route: Route;
  kind: RouteKind;
  context: Pick<CampusLink, "building" | "at" | "course">;
  mapsKey: string | null;
  onRetry: () => void;
  onShare: () => void;
  onCopy: () => void;
  copied: boolean;
  onStartElsewhere: () => void;
}) {
  const t = useT().campus;
  const inside = useRef<HTMLElement>(null);
  const [insideVisible, setInsideVisible] = useState(true);
  const entrance = kind === "yours" ? routeEntrance(route) : null;
  const room = route.destination;
  const goal = routeGoal(route);
  const floor = routeFloor(route, t);
  const building = room?.area ?? context.building ?? null;

  // On a phone, offer a way down to leg 2 while it is out of sight.
  useEffect(() => {
    const el = inside.current;
    if (!entrance || !el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setInsideVisible(entry.isIntersecting || entry.boundingClientRect.top < 0), {
      rootMargin: "0px 0px -35% 0px",
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [entrance]);

  const view = (
    <RouteView
      route={route}
      kind={kind}
      inJourney={kind === "yours"}
      onRetry={onRetry}
      onShare={onShare}
      onCopy={onCopy}
      copied={copied}
    />
  );
  if (kind === "example") return view;

  const goInside = () => reveal(inside.current);
  const startName = (route.origin ?? route.steps[0])?.name;

  return (
    <div className="space-y-4">
      <section className="card p-4 sm:p-5" aria-labelledby="campus-journey-title">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">{t.journey.progress}</p>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 id="campus-journey-title" className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            {goal}
          </h2>
          {room && room.label !== goal && room.name !== goal && <span className="text-sm text-slate-600">{room.label}</span>}
        </div>
        <p className="mt-1 text-sm text-slate-600">{[building, floor, room ? t.reach[room.reach] : null].filter(Boolean).join(" · ")}</p>
        {context.course ? (
          <p className="mt-2 inline-flex rounded-full bg-brand-50 px-3 py-1 text-sm font-medium text-brand-800">
            📚 {t.journey.forClass(context.course, context.at ?? null)}
          </p>
        ) : (
          context.at && <p className="mt-2 inline-flex rounded-full bg-brand-50 px-3 py-1 text-sm font-medium text-brand-800">🕘 {t.journey.atTime(context.at)}</p>
        )}
        {entrance && (
          <ol className="mt-4 grid gap-2 text-sm sm:grid-cols-[1fr_auto_1fr] sm:items-center">
            <li className="flex items-center gap-2 rounded-2xl bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
              <span aria-hidden className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">1</span>
              <span className="min-w-0">{t.journey.step1(entrance.name)}</span>
            </li>
            <li aria-hidden className="hidden text-slate-400 sm:block">→</li>
            <li className="flex items-center gap-2 rounded-2xl bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
              <span aria-hidden className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">2</span>
              <span className="min-w-0">{t.journey.step2(goal)}</span>
            </li>
          </ol>
        )}
      </section>

      {entrance && (
        <section className="card p-4 sm:p-5" aria-labelledby="campus-leg1">
          <h3 id="campus-leg1" className="mb-3 flex items-center gap-2 text-lg font-semibold text-slate-900">
            <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">1</span>
            {t.journey.leg1}
          </h3>
          <GetThere entrance={entrance} at={context.at ?? null} mapsKey={mapsKey} onInside={goInside} />
        </section>
      )}

      <section ref={inside} aria-labelledby="campus-leg2" className="scroll-mt-20 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          <h3 id="campus-leg2" className="flex items-center gap-2 text-lg font-semibold text-slate-900">
            {entrance && (
              <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">2</span>
            )}
            {t.journey.leg2}
          </h3>
          {route.steps.length > 0 && (
            <button type="button" className="text-sm font-medium text-brand-700 hover:underline" onClick={onStartElsewhere} aria-haspopup="dialog">
              {t.journey.startElsewhere}
            </button>
          )}
        </div>
        {startName && route.steps.length > 1 && (
          <p className="px-1 text-sm text-slate-600">{route.automatic ? t.journey.autoStart(startName) : t.journey.chosenStart(startName)}</p>
        )}
        {view}
      </section>

      {entrance && !insideVisible && (
        <div className="fixed inset-x-3 bottom-4 z-30 mr-[6.5rem] lg:hidden">
          <button type="button" onClick={goInside} className="btn-primary w-full py-3 shadow-lg shadow-brand-900/20">
            {t.journey.nextInside} ↓
          </button>
        </div>
      )}
    </div>
  );
}
