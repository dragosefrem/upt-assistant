import { SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { InvitationForm } from "@/components/InvitationForm";
import { InvitationRefresh } from "@/components/InvitationRefresh";
import { eventLabel, responseLabel } from "@/components/GroupEventSummary";
import { SavedContacts } from "@/components/SavedContacts";
import type { Locale } from "@/i18n/config";
import type { Messages } from "@/i18n/messages";
import { getLocale, getT } from "@/i18n/server";
import { requireOnboardedUser } from "@/lib/auth";
import { currentContactStatuses, type ContactStatus } from "@/lib/contact-schedule";
import { contactList, lookupContact } from "@/lib/contacts";
import { myGroupEvents } from "@/lib/group-events";
import { listSavedContacts } from "@/lib/saved-contacts";
import { capitalize, formatDate, formatMinutes, nowLocal } from "@/lib/time";
import { contactAction, inviteAction, rsvpAction } from "./actions";

export async function generateMetadata() {
  const t = await getT();
  return { title: t.contacts.page.title };
}

type Contact = ReturnType<typeof contactList>[number];

function StatusLine({ status, t }: { status: ContactStatus; t: Messages }) {
  const label = status.state === "activity" ? t.common.kinds[status.kind]
    : status.state === "free" ? t.contacts.page.list.free : t.contacts.schedule.busy;
  const color = status.state === "activity" ? "bg-brand-50 text-brand-700"
    : status.state === "free" ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800";
  return (
    <p className="my-1 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
      <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold ${color}`}>
        <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />{label}
      </span>
      {status.state === "activity" && <span className="min-w-0 break-words text-slate-700">
        {status.title}{status.room && <span className="text-slate-600"> · {status.room}</span>}
      </span>}
    </p>
  );
}

function ContactRow({ person, userId, t, status }: { person: Contact; userId: string; t: Messages; status?: ContactStatus }) {
  const page = t.contacts.page;
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-3">
      <div className={person.accepted ? "min-w-0 flex-[1_1_12rem]" : "min-w-0"}>
        <p className="break-words text-sm font-semibold">{person.name}</p>
        {status && <StatusLine status={status} t={t} />}
        <p className="break-all text-xs text-slate-600">{person.email}</p>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {person.accepted && <Link href={`/contacts/${person.id}/schedule`} prefetch={false}
          aria-label={page.list.viewScheduleFor(person.name)} className="btn-secondary">{page.list.viewSchedule}</Link>}
        <InvitationForm action={contactAction.bind(null, person.id)} className="flex flex-wrap items-center gap-1">
          {person.accepted ? <button className="btn-ghost" name="action" value="remove">{t.common.actions.remove}</button>
            : person.requestedBy === userId ? <button className="btn-ghost" name="action" value="cancel">{page.requests.cancel}</button>
            : <><button className="btn-primary" name="action" value="accept">{t.common.actions.accept}</button>
              <button className="btn-ghost" name="action" value="decline">{t.common.actions.decline}</button></>}
        </InvitationForm>
      </div>
    </li>
  );
}

function EventList({ events, t, locale, canReply = false }: { events: ReturnType<typeof myGroupEvents>; t: Messages; locale: Locale; canReply?: boolean }) {
  return (
    <ul className="divide-y divide-slate-100">
      {events.map((event) => (
        <li key={event.id}>
          <Link className="block rounded-lg py-3 hover:bg-slate-50 focus-visible:outline-brand-500" href={`/contacts/events/${event.id}`}>
            <span className="block text-xs font-medium text-teal-800">{eventLabel(event.status, event.going, locale)} · {t.contacts.event.going(event.going)}</span>
            <span className="mt-1 block break-words font-semibold text-brand-700">{event.title}</span>
            <span className="block text-sm text-slate-700">{capitalize(formatDate(event.date, { weekday: "short", day: "numeric", month: "short" }, locale))} · {formatMinutes(event.startMin)}–{formatMinutes(event.endMin)}</span>
            <span className="text-xs text-slate-500">{t.contacts.event.hostedBy(event.host)} · {responseLabel(event.response, locale)}</span>
          </Link>
          {canReply && <InvitationForm action={rsvpAction.bind(null, event.id)} className="mb-3 flex gap-2">
            <button className="btn-primary" name="response" value="accepted">{t.contacts.event.accept}</button>
            <button className="btn-ghost" name="response" value="declined">{t.contacts.event.decline}</button>
          </InvitationForm>}
        </li>
      ))}
    </ul>
  );
}

export default async function ContactsPage({ searchParams }: PageProps<"/contacts">) {
  const user = await requireOnboardedUser();
  const t = await getT();
  const locale = await getLocale();
  const page = t.contacts.page;
  const { email: query } = await searchParams;
  const email = typeof query === "string" ? query.trim() : "";
  const people = contactList(user.id);
  const { person: found, error } = query === undefined ? {} : lookupContact(email);
  const connection = people.find((p) => p.id === found?.id);
  const contacts = people.filter((p) => p.accepted);
  const incoming = people.filter((p) => !p.accepted && p.requestedBy !== user.id);
  const sent = people.filter((p) => !p.accepted && p.requestedBy === user.id);
  const events = myGroupEvents(user.id);
  const now = nowLocal();
  const today = now.date;
  const statuses = currentContactStatuses(user.id, locale, now);
  const future = events.filter((e) => e.date >= today);
  const needsReply = (event: (typeof events)[number]) => event.response === "pending" && event.status !== "expired";
  const invitations = future.filter(needsReply);
  const upcoming = future.filter((event) => !needsReply(event));
  const past = events.filter((e) => e.date < today).reverse();

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5">
      <InvitationRefresh />
      <header className="page-heading flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1>{page.title}</h1>
          <p className="mt-1 text-sm text-slate-600">{user.shareActivityDetails ? page.sharingDetails : page.sharingAvailability}</p>
        </div>
        <Link className="btn-primary" href="/contacts/plan">{page.planEvent}</Link>
      </header>
      {(incoming.length > 0 || invitations.length > 0) && (
        <section id="inbox" className="card scroll-mt-20 p-5" aria-labelledby="reply-heading">
          <h2 id="reply-heading" className="text-lg font-semibold">{page.requests.needsReply}</h2>
          <div className="mt-3 grid items-start gap-x-8 gap-y-3 sm:grid-cols-[repeat(auto-fit,minmax(16rem,1fr))]">
            {incoming.length > 0 && <div>
              <h3 className="text-sm font-medium text-slate-600">{page.requests.heading}</h3>
              <ul className="divide-y divide-slate-100">{incoming.map((p) => <ContactRow key={p.id} person={p} userId={user.id} t={t} />)}</ul>
            </div>}
            {invitations.length > 0 && <div>
              <h3 className="text-sm font-medium text-slate-600">{page.events.invitations}</h3>
              <EventList events={invitations} t={t} locale={locale} canReply />
            </div>}
          </div>
        </section>
      )}
      <div className="grid items-start gap-5 md:grid-cols-2">
        <div className="space-y-5">
          <section className="card p-5" aria-labelledby="your-contacts">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <h2 id="your-contacts" className="text-lg font-semibold">{page.list.heading}</h2>
              <Link href="/settings#contact-privacy" className="inline-flex min-h-8 items-center gap-1.5 rounded text-sm font-medium text-brand-700 hover:underline">
                <SlidersHorizontal aria-hidden="true" size={15} />{page.list.sharing}
              </Link>
            </div>
            {contacts.length ? <>
              <p className="text-xs text-slate-600">{page.list.asOf(formatMinutes(now.minutes))}</p>
              <ul className="mt-1 divide-y divide-slate-100">{contacts.map((p) => <ContactRow key={p.id} person={p} userId={user.id} t={t} status={statuses.get(p.id)} />)}</ul>
            </>
              : <p className="mt-2 text-sm text-slate-600">{page.list.empty}</p>}
          </section>
          <section className="card p-5">
            <h2 className="text-lg font-semibold">{page.find.heading}</h2>
            <form action="/contacts" noValidate className="mt-3">
              <label htmlFor="contact-email" className="label">{page.find.emailLabel}</label>
              <div className="flex gap-2">
                <input id="contact-email" name="email" type="email" defaultValue={email} required className="field min-w-0" placeholder={page.find.emailPlaceholder} />
                <button className="btn-secondary">{page.find.button}</button>
              </div>
            </form>
            {query !== undefined && <div className="mt-3 border-t border-slate-100 pt-3 text-sm" role="status">
              {error ? t.contacts.errors[error] : found && (found.id === user.id ? page.find.yourself :
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong>{found.name}</strong>
                  {connection ? <span className="text-slate-600">{connection.accepted ? page.find.alreadyContact : connection.requestedBy === user.id ? page.find.invitationSent : <a className="font-medium text-brand-700 underline" href="#inbox">{page.find.seeIncoming}</a>}</span>
                    : <InvitationForm action={inviteAction.bind(null, found.email)}><button className="btn-primary">{page.find.sendRequest}</button></InvitationForm>}
                </div>)}
            </div>}
          </section>
          {sent.length > 0 && <details className="card p-5">
            <summary className="font-semibold">{page.requests.sent}</summary>
            <ul className="mt-2 divide-y divide-slate-100">{sent.map((p) => <ContactRow key={p.id} person={p} userId={user.id} t={t} />)}</ul>
          </details>}
        </div>
        <div className="space-y-5">
          <section className="card p-5">
            <h2 className="text-lg font-semibold">{page.events.heading}</h2>
            {upcoming.length ? <EventList events={upcoming} t={t} locale={locale} /> : <p className="mt-2 text-sm text-slate-600">{page.events.empty}</p>}
            {past.length > 0 && <details className="mt-4 border-t border-slate-200 pt-3">
              <summary className="cursor-pointer text-sm font-medium">{page.events.past(past.length)}</summary>
              <EventList events={past} t={t} locale={locale} />
            </details>}
          </section>
          <SavedContacts people={listSavedContacts(user.id, locale)} />
        </div>
      </div>
    </div>
  );
}
