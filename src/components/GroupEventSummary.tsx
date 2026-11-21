import type { EventStatus, Rsvp } from "@/db/schema";
import type { Locale } from "@/i18n/config";
import { contacts } from "@/i18n/messages/contacts";
import { getLocale, getT } from "@/i18n/server";
import { capitalize, formatDate, formatMinutes, nowLocal } from "@/lib/time";

export function responseLabel(response: Rsvp, locale: Locale): string {
  return contacts[locale].event.response[response];
}

export function eventLabel(status: EventStatus, going: number, locale: Locale): string {
  const t = contacts[locale].event.status;
  if (status === "expired") return t.expired;
  if (status === "pending") return t.pending;
  if (going >= 2) return t.confirmed;
  return going === 1 ? t.needsOne : t.needsTwo;
}

type Summary = {
  title: string; host: string; location: string | null; date: string; startMin: number;
  endMin: number; deadline: number; status: EventStatus; going: number;
};

export async function GroupEventSummary({ event }: { event: Summary }) {
  const t = (await getT()).contacts.event;
  const locale = await getLocale();
  const cutoff = nowLocal(new Date(event.deadline));
  const day = (date: string) => capitalize(formatDate(date, { weekday: "short", day: "numeric", month: "short" }, locale));
  return (
    <header className="space-y-3">
      <p className="text-sm font-medium text-teal-800">{eventLabel(event.status, event.going, locale)} · {t.going(event.going)}</p>
      <h1 className="break-words text-3xl font-semibold tracking-tight">{event.title}</h1>
      <p className="text-sm text-slate-600">{t.hostedBy(event.host)}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 border-y border-slate-200 py-4 text-sm">
        <dt className="text-slate-500">{t.when}</dt>
        <dd>{day(event.date)} · {t.campusTime(`${formatMinutes(event.startMin)}–${formatMinutes(event.endMin)}`)}</dd>
        {event.location && <><dt className="text-slate-500">{t.where}</dt><dd className="break-words">{event.location}</dd></>}
        <dt className="text-slate-500">{t.replyBy}</dt><dd>{day(cutoff.date)} · {t.campusTime(formatMinutes(cutoff.minutes))}</dd>
      </dl>
      {event.status === "expired" && <p className="text-sm text-slate-600">{t.expiredNote}</p>}
      {event.status === "confirmed" && event.going < 2 && <p className="text-sm text-slate-600">{t.returnsNote}</p>}
      {event.status === "pending" && <p className="text-sm text-slate-600">{t.pendingNote}</p>}
    </header>
  );
}

export async function RsvpButtons({ response }: { response: Rsvp | null }) {
  const t = (await getT()).contacts.event;
  return (
    <>
      {response && <p className="w-full text-sm">{t.yourRsvp} · <strong>{t.response[response]}</strong></p>}
      {response !== "accepted" && <button className="btn-primary" name="response" value="accepted">{response === null ? t.join : t.accept}</button>}
      {response && response !== "declined" && <button className="btn-secondary" name="response" value="declined">{response === "accepted" ? t.leave : t.decline}</button>}
    </>
  );
}
