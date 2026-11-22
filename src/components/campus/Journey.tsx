"use client";

import { useLocale, useT } from "@/i18n/client";
import { routeEntrance, routeGoal, type CampusLink } from "@/lib/campuspath/links";
import type { Route } from "@/lib/campuspath/types";
import { formatDate } from "@/lib/time";
import { routeFloor } from "./format";
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
  context: Pick<CampusLink, "building" | "at" | "date" | "course">;
  mapsKey: string | null;
  onRetry: () => void;
  onShare: () => void;
  onCopy: () => void;
  copied: boolean;
  onStartElsewhere: () => void;
}) {
  const t = useT().campus;
  const locale = useLocale();
  const entrance = kind === "yours" ? routeEntrance(route) : null;
  const room = route.destination;
  const goal = routeGoal(route);
  const floor = routeFloor(route, t);
  const building = room?.area ?? context.building ?? null;

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

  const startName = (route.origin ?? route.steps[0])?.name;
  const legs = entrance ? [t.journey.step1(entrance.name), t.journey.step2(goal)] : [];

  return (
    <div className="space-y-4">
      <section className="card p-4 sm:p-5" aria-labelledby="campus-journey-title">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 id="campus-journey-title" className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            {goal}
          </h2>
          {room && room.label !== goal && room.name !== goal && <span className="text-sm text-slate-600">{room.label}</span>}
        </div>
        <p className="mt-1 text-sm text-slate-600">{[building, floor, room ? t.reach[room.reach] : null].filter(Boolean).join(" · ")}</p>
        {route.warning && (
          <p role="note" className="mt-3 rounded-2xl bg-amber-50 px-3.5 py-2.5 text-sm font-medium text-amber-900 ring-1 ring-amber-200">{route.warning}</p>
        )}
        {context.course ? (
          <p className="mt-2 inline-flex rounded-full bg-brand-50 px-3 py-1 text-sm font-medium text-brand-800">
            📚 {t.journey.forClass(context.course, context.at ?? null)}
            {context.date && ` · ${formatDate(context.date, { weekday: "short", day: "numeric", month: "short" }, locale)}`}
          </p>
        ) : (
          context.at && <p className="mt-2 inline-flex rounded-full bg-brand-50 px-3 py-1 text-sm font-medium text-brand-800">🕘 {t.journey.atTime(context.at)}</p>
        )}
        {legs.length > 0 && (
          <ol className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
            {legs.map((text, index) => (
              <li key={index}>
                <a href={`#campus-leg${index + 1}`} className="flex h-full items-center gap-2 rounded-xl bg-brand-50 px-3 py-2.5 font-medium text-brand-800 hover:underline">
                  <span aria-hidden className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-600 text-xs text-white">{index + 1}</span>
                  <span>{text}</span>
                </a>
              </li>
            ))}
          </ol>
        )}
      </section>

      {entrance && (
        <section className="card p-4 sm:p-5" aria-labelledby="campus-leg1">
          <h3 id="campus-leg1" tabIndex={-1} className="mb-3 flex scroll-mt-20 items-center gap-2 text-lg font-semibold text-slate-900">
            <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">1</span>
            {t.journey.leg1}
          </h3>
          <GetThere entrance={entrance} at={context.at ?? null} mapsKey={mapsKey} />
        </section>
      )}

      <section aria-labelledby="campus-leg2" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          <h3 id="campus-leg2" tabIndex={-1} className="flex scroll-mt-20 items-center gap-2 text-lg font-semibold text-slate-900">
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

    </div>
  );
}
