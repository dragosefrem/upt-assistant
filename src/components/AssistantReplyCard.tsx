"use client";

import Link from "next/link";
import { ArrowRight, CalendarDays, CalendarPlus, ChevronDown, Clock3, GraduationCap, ListClock, Navigation, Volume2 } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { useLocale, useT } from "@/i18n/client";
import type { CardEvent, CardSlot, ReplyCard } from "@/lib/assistant/reply-card";
import { campusJourneyHref } from "@/lib/campuspath/links";
import { kindLabel, kindStyle } from "@/lib/kinds";
import type { CalEvent } from "@/lib/schedule";
import { capitalize, formatDate, formatDateRange, formatMinutes, nowLocal } from "@/lib/time";
import { PersonalEventDialog } from "./PersonalEventDialog";

const appearance = {
  schedule: { icon: CalendarDays, color: "bg-brand-50 text-brand-700" },
  next: { icon: ListClock, color: "bg-indigo-50 text-indigo-700" },
  exams: { icon: GraduationCap, color: "bg-rose-50 text-rose-700" },
  free: { icon: Clock3, color: "bg-teal-50 text-teal-700" },
};

function ResultList<T>({ rows, count, children }: { rows: T[]; count: number; children: (row: T, index: number) => ReactNode }) {
  const t = useT().assistant.cards;
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const visible = expanded ? rows : rows.slice(0, 2);
  return (
    <>
      <ul id={listId} className="divide-y divide-slate-100">
        {visible.map((row, i) => <li key={i} className="px-3 py-2.5">{children(row, i)}</li>)}
      </ul>
      {rows.length > 2 && (
        <button type="button" aria-expanded={expanded} aria-controls={listId} onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center justify-center gap-1 border-t border-slate-100 py-2 text-xs font-semibold text-brand-700 hover:bg-brand-50">
          {expanded ? t.less : t.more(rows.length - 2)}
          <ChevronDown size={14} aria-hidden className={expanded ? "rotate-180" : ""} />
        </button>
      )}
      {expanded && count > rows.length && <p className="px-3 pb-2 text-xs text-slate-600">{t.showing(rows.length, count)}</p>}
    </>
  );
}

function Room({ event, onNavigate }: { event: CardEvent; onNavigate?: () => void }) {
  const t = useT();
  const academic = event.kind !== "shared" && event.kind !== "personal";
  if (!event.room) return academic ? <p className="mt-1 text-xs text-slate-500">{t.exams.card.roomUnknown}</p> : null;
  const room = academic ? t.exams.card.room(event.room) : event.room;
  const destination = event.campus_room ?? (event.building ? event.room : null);
  return (
    <div className="mt-1 flex flex-wrap items-baseline gap-x-1.5 text-xs">
      {destination ? (
        <Link prefetch={false} onNavigate={onNavigate} aria-label={t.campus.rooms.showWayTo(event.room)}
          href={campusJourneyHref({ to: destination, building: event.building, at: event.start, date: event.date, course: event.title })}
          className="inline-flex items-center gap-1 font-medium text-brand-700 underline decoration-brand-200 underline-offset-2 hover:decoration-current">
          <Navigation aria-hidden size={12} />{room}
        </Link>
      ) : <span className="text-slate-700">{room}</span>}
      {event.building && <span className="text-slate-500">{event.approximate ? t.campus.rooms.approximate(event.building) : event.building}</span>}
    </div>
  );
}

function EventRow({ event, onNavigate }: { event: CardEvent; onNavigate?: () => void }) {
  const locale = useLocale();
  return (
    <div className="flex gap-3">
      <div className="w-11 shrink-0 text-right tabular-nums">
        <time className="block text-sm font-semibold">{event.start}</time>
        {event.end && <time className="block text-xs text-slate-500">{event.end}</time>}
      </div>
      <div className="min-w-0 flex-1 border-l border-slate-200 pl-3">
        <p className="font-semibold leading-snug text-slate-900">{event.title}</p>
        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-600">
          <span aria-hidden className={`size-1.5 rounded-full ${kindStyle(event.kind).dot}`} />{kindLabel(event.kind, locale)}
        </p>
        <Room event={event} onNavigate={onNavigate} />
      </div>
    </div>
  );
}

function FreeTimes({ card, canPlan }: { card: Extract<ReplyCard, { type: "free" }>; canPlan: boolean }) {
  const t = useT();
  const locale = useLocale();
  const [draft, setDraft] = useState<{ date: string; start: number; end: number } | null>(null);
  const [checking, setChecking] = useState<CardSlot | null>(null);
  const [notice, setNotice] = useState("");
  const now = nowLocal();

  const plan = async (slot: CardSlot) => {
    if (checking) return;
    setChecking(slot);
    setNotice("");
    try {
      // Cards are snapshots. Recheck the proposed hour against the current
      // calendar before opening the ordinary, editable event form.
      const response = await fetch(`/api/events?from=${slot.date}&to=${slot.date}`, { cache: "no-store" });
      if (!response.ok) throw new Error();
      const { events }: { events: CalEvent[] } = await response.json();
      const current = nowLocal();
      const [h, m] = slot.start.split(":").map(Number);
      const slotStart = h * 60 + m;
      const start = slot.date === current.date ? Math.max(slotStart, current.minutes) : slotStart;
      const end = Math.min(start + 60, slotStart + slot.minutes, 1439);
      if (slot.date < current.date || start >= end || events.some((e) => e.startMin < end && e.endMin > start)) {
        setNotice(t.assistant.cards.slotChanged);
      } else {
        setDraft({ date: slot.date, start, end });
      }
    } catch {
      setNotice(t.calendar.grid.loadFailed);
    } finally {
      setChecking(null);
    }
  };
  return (
    <>
      <ResultList rows={card.free} count={card.count}>{(slot, i) => (
        <>
          {card.from !== card.to && card.free[i - 1]?.date !== slot.date && <p className="mb-1 text-xs text-slate-600">{capitalize(formatDate(slot.date, undefined, locale))}</p>}
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2">
            <strong className="text-base font-semibold tabular-nums">{slot.start}–{slot.end}</strong>
            <span className="rounded bg-teal-50 px-1.5 py-0.5 text-xs font-medium text-teal-800">{slot.minutes} min</span>
          </div>
          {canPlan && card.for === "you" && (slot.date > now.date || (slot.date === now.date && slot.end > formatMinutes(now.minutes))) && (
            <button type="button" aria-disabled={checking !== null} aria-busy={checking === slot} onClick={() => void plan(slot)} className="mt-1 inline-flex items-center gap-1 py-1 text-xs font-semibold text-brand-700 hover:underline aria-disabled:opacity-60">
              <CalendarPlus size={14} aria-hidden />{checking === slot ? t.common.status.loading : t.assistant.cards.plan}
              <span className="sr-only">{` · ${slot.date} · ${slot.start}–${slot.end}`}</span>
            </button>
          )}
        </>
      )}</ResultList>
      {draft && canPlan && <PersonalEventDialog defaultDate={draft.date} defaultStartMin={draft.start}
        defaultEndMin={draft.end} onClose={() => setDraft(null)} onSaved={(title) => setNotice(t.calendar.grid.added(title))} />}
      {notice && <p role="status" className="border-t border-slate-100 px-3 py-2 text-xs text-slate-700">{notice}</p>}
    </>
  );
}

export function AssistantReplyCard({ card, transcript, onRead, onNavigate, canPlan }: {
  card: ReplyCard; transcript?: ReactNode; onRead: () => void; onNavigate?: () => void; canPlan: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const headingId = useId();
  const { icon: Icon, color } = appearance[card.type];
  const day = (date: string) => capitalize(formatDate(date, undefined, locale));
  const { cards } = t.assistant;
  let subtitle: string | undefined;
  if (card.type === "schedule" || card.type === "free") {
    subtitle = card.from === card.to ? day(card.from) : formatDateRange(card.from, card.to, locale);
    if (card.type === "free" && card.for !== "you") subtitle = `${card.for} · ${subtitle}`;
  } else if (card.type === "next") {
    const [date, time] = card.now.split(" ");
    subtitle = cards.asOf(`${day(date)} · ${time}`);
  }

  return (
    <article aria-labelledby={headingId} className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white text-sm text-slate-900 shadow-sm [overflow-wrap:anywhere]">
      <header className="flex items-center gap-2.5 border-b border-slate-100 px-3 py-2.5">
        <span className={`grid size-8 shrink-0 place-items-center rounded-lg ${color}`}><Icon size={18} aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <h3 id={headingId} className="font-semibold leading-snug">{cards[card.type]}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-slate-600">{subtitle}</p>}
        </div>
        <button type="button" onClick={onRead} aria-label={t.assistant.speech.readAloud} title={t.assistant.speech.readAloud}
          className="grid size-8 shrink-0 place-items-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-brand-700">
          <Volume2 size={16} aria-hidden />
        </button>
      </header>
      {card.type === "schedule" && (
        <>
          {card.holidays.map((h) => <p key={h.date + h.name} className="bg-amber-50 px-3 py-2 text-xs text-amber-900">{t.assistant.basic.holiday(day(h.date), h.name)}</p>)}
          <ResultList rows={card.events} count={card.count}>{(event, i) => (
            <>
              {card.from !== card.to && card.events[i - 1]?.date !== event.date && <p className="mb-1.5 text-xs font-medium text-slate-600">{day(event.date)}</p>}
              <EventRow event={event} onNavigate={onNavigate} />
            </>
          )}</ResultList>
        </>
      )}
      {card.type === "next" && (
        <div className="divide-y divide-slate-100">
          {(["current", "next"] as const).map((key) => {
            const event = card[key];
            return event && <div key={key} className="px-3 py-2.5">
              <p className="mb-1.5 text-xs font-medium text-indigo-700">{key === "current" ? t.calendar.nextUp.now : t.calendar.nextUp.next} · {day(event.date)}</p>
              <EventRow event={event} onNavigate={onNavigate} />
            </div>;
          })}
        </div>
      )}
      {card.type === "exams" && (
        <>
          <ResultList rows={card.exams} count={card.count}>{(exam) => (
            <div className="flex items-start gap-3">
              <time dateTime={exam.date} aria-label={day(exam.date)} className="flex w-11 shrink-0 flex-col items-center rounded-lg bg-rose-50 py-1 text-rose-800">
                <span className="text-[10px] font-medium uppercase">{formatDate(exam.date, { month: "short" }, locale)}</span>
                <span className="text-lg font-semibold leading-none">{Number(exam.date.slice(8))}</span>
              </time>
              <div className="min-w-0">
                <p className="font-semibold leading-snug">{exam.course}</p>
                <p className="mt-0.5 text-xs text-slate-600">{capitalize(formatDate(exam.date, { weekday: "short", day: "numeric", month: "short", year: "numeric" }, locale))} · {exam.start}{exam.end && `–${exam.end}`}</p>
                <Room event={{ ...exam, title: exam.course, kind: "exam" }} onNavigate={onNavigate} />
                {(exam.for || exam.teacher) && <p className="mt-1 text-xs text-slate-600">{[exam.for, exam.teacher].filter(Boolean).join(" · ")}</p>}
              </div>
            </div>
          )}</ResultList>
          <Link href="/exams" onNavigate={onNavigate} className="flex items-center justify-between border-t border-slate-100 px-3 py-2 text-xs font-semibold text-brand-700 hover:bg-brand-50">
            {cards.examCalendar}<ArrowRight size={14} aria-hidden />
          </Link>
        </>
      )}
      {card.type === "free" && <FreeTimes card={card} canPlan={canPlan} />}
      {transcript && (
        <details className="border-t border-slate-100 px-3 py-1.5 text-xs text-slate-600">
          <summary className="cursor-pointer py-1 hover:text-brand-700">{cards.transcript}</summary>
          <div className="whitespace-pre-wrap pb-1.5 pt-1 leading-relaxed">{transcript}</div>
        </details>
      )}
    </article>
  );
}
