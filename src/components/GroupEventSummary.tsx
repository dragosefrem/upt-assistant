import type { Attendance, EventStatus } from "@/db/schema";
import { formatDate, formatMinutes, nowLocal } from "@/lib/time";

export const responseLabel: Record<Attendance, string> = {
  accepted: "Going", declined: "Declined", pending: "Awaiting reply",
};

export function eventLabel(status: EventStatus, going: number) {
  if (status === "expired") return "Expired";
  if (status === "pending") return "Collecting replies";
  if (going >= 2) return "Confirmed";
  return going === 1 ? "Needs one more RSVP" : "Needs two RSVPs";
}

type Summary = {
  title: string; host: string; location: string | null; date: string; startMin: number;
  endMin: number; deadline: number; status: EventStatus; going: number;
};

export function GroupEventSummary({ event }: { event: Summary }) {
  const cutoff = nowLocal(new Date(event.deadline));
  const day = (date: string) => formatDate(date, { weekday: "short", day: "numeric", month: "short" });
  return (
    <header className="space-y-3">
      <p className="text-sm font-medium text-teal-800">{eventLabel(event.status, event.going)} · {event.going} going</p>
      <h1 className="break-words text-3xl font-semibold tracking-tight">{event.title}</h1>
      <p className="text-sm text-slate-600">Hosted by {event.host}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 border-y border-slate-200 py-4 text-sm">
        <dt className="text-slate-500">When</dt>
        <dd>{day(event.date)} · {formatMinutes(event.startMin)}–{formatMinutes(event.endMin)} (Timișoara)</dd>
        {event.location && <><dt className="text-slate-500">Where</dt><dd className="break-words">{event.location}</dd></>}
        <dt className="text-slate-500">Reply by</dt><dd>{day(cutoff.date)} · {formatMinutes(cutoff.minutes)} (Timișoara)</dd>
      </dl>
      {event.status === "expired" && <p className="text-sm text-slate-600">Fewer than two people accepted by the deadline.</p>}
      {event.status === "confirmed" && event.going < 2 && <p className="text-sm text-slate-600">The event returns to calendars when two people are going.</p>}
      {event.status === "pending" && <p className="text-sm text-slate-600">The event confirms when everyone invited accepts, or at the deadline with at least two people going.</p>}
    </header>
  );
}

export function RsvpButtons({ response }: { response: Attendance | null }) {
  return (
    <>
      {response && <p className="w-full text-sm">Your RSVP · <strong>{responseLabel[response]}</strong></p>}
      {response !== "accepted" && <button className="btn-primary" name="response" value="accepted">{response === null ? "Join event" : "Accept"}</button>}
      {response && response !== "declined" && <button className="btn-secondary" name="response" value="declined">{response === "accepted" ? "Leave event" : "Decline"}</button>}
    </>
  );
}
