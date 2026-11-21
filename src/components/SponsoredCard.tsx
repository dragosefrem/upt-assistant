"use client";

import { ChevronDown, Clock3, MapPin, Ticket } from "lucide-react";
import type { ReactNode } from "react";
import { useLocale, useT } from "@/i18n/client";
import { capitalize, formatDate } from "@/lib/time";

interface CardProps {
  title: string;
  sponsor: string;
  location: string;
  description: string;
  date: string;
  time: string;
  preview?: boolean;
  children?: ReactNode;
}

/** The composer previews the same card a student will see. */
export function SponsoredCard({ title, sponsor, date, time, location, description, preview, children }: CardProps) {
  const t = useT().sponsored;
  const locale = useLocale();
  return (
    <article className="@container overflow-hidden rounded-2xl border border-cyan-900/15 bg-white">
      <div className="grid @xl:grid-cols-[minmax(0,1fr)_auto]">
        <div className="flex gap-3 p-3.5">
          {date && <time dateTime={date} aria-label={formatDate(date, undefined, locale)}
            className="flex h-fit w-14 shrink-0 flex-col items-center rounded-xl border border-cyan-800/15 bg-cyan-50 py-2 text-cyan-950">
            <span className="text-[10px] leading-none font-bold tracking-wide uppercase">{formatDate(date, { month: "short" }, locale)}</span>
            <span className="mt-1 text-2xl leading-none font-semibold tracking-tight tabular-nums">{Number(date.slice(-2))}</span>
          </time>}
          <div className="min-w-0 space-y-1">
            <p className="flex items-start gap-1.5 text-xs font-semibold text-cyan-800">
              <Ticket size={14} className="mt-px shrink-0" aria-hidden /><span className="wrap-anywhere">{t.by(sponsor)}</span>
            </p>
            <h3 className="text-lg leading-tight font-semibold tracking-tight text-ink wrap-anywhere">{title}</h3>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-slate-700">
              {time && <span className="inline-flex items-center gap-1.5"><Clock3 size={14} className="shrink-0" aria-hidden />
                {date && `${capitalize(formatDate(date, { weekday: "short" }, locale))} · `}{time}
              </span>}
              {location && <span className="inline-flex items-start gap-1.5"><MapPin size={14} className="mt-0.5 shrink-0" aria-hidden /><span className="wrap-anywhere">{location}</span></span>}
            </div>
            {description && <details open={preview} className="group/about pt-1 text-sm">
              <summary className="inline-flex cursor-pointer list-none items-center gap-1 font-medium text-cyan-900">
                {t.about}<ChevronDown size={14} aria-hidden className="group-open/about:rotate-180" />
              </summary>
              <p className="mt-1.5 leading-relaxed whitespace-pre-line text-slate-600 wrap-anywhere">{description}</p>
            </details>}
          </div>
        </div>
        {children && <div className="flex flex-wrap items-center gap-1 border-t border-dashed border-cyan-900/15 px-3 py-1.5 @xl:flex-col @xl:justify-center @xl:border-t-0 @xl:border-l">{children}</div>}
      </div>
    </article>
  );
}
