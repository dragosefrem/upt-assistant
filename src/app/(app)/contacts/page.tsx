import Link from "next/link";
import { InvitationForm } from "@/components/InvitationForm";
import { InvitationRefresh } from "@/components/InvitationRefresh";
import { eventLabel, responseLabel } from "@/components/GroupEventSummary";
import { SavedContacts } from "@/components/SavedContacts";
import type { Locale } from "@/i18n/config";
import type { Messages } from "@/i18n/messages";
import { getLocale, getT } from "@/i18n/server";
import { requireOnboardedUser } from "@/lib/auth";
import { contactList, findPerson } from "@/lib/contacts";
import { myGroupEvents } from "@/lib/group-events";
import { listSavedContacts } from "@/lib/saved-contacts";
import { capitalize, formatDate, formatMinutes, nowLocal } from "@/lib/time";
import { contactAction, inviteAction } from "./actions";

export async function generateMetadata() {
  const t = await getT();
  return { title: t.contacts.page.title };
}

type Contact = ReturnType<typeof contactList>[number];

function ContactRow({ person, userId, t }: { person: Contact; userId: string; t: Messages }) {
  const page = t.contacts.page;
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-3">
      <div className="min-w-0">
        <p className="break-words text-sm font-semibold">{person.name}</p>
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

function EventList({ events, t, locale }: { events: ReturnType<typeof myGroupEvents>; t: Messages; locale: Locale }) {
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
  const found = email ? findPerson(email) : undefined;
  const connection = people.find((p) => p.id === found?.id);
  const contacts = people.filter((p) => p.accepted);
  const requests = people.filter((p) => !p.accepted);
  const events = myGroupEvents(user.id);
  const today = nowLocal().date;
  const upcoming = events.filter((e) => e.date >= today);
  const past = events.filter((e) => e.date < today).reverse();

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5">
      <InvitationRefresh />
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{page.title}</h1>
          <p className="mt-1 text-sm text-slate-600">{page.intro}</p>
        </div>
        <Link className="btn-primary" href="/contacts/plan">{page.planEvent}</Link>
      </header>
      <div className="grid items-start gap-5 md:grid-cols-2">
        <div className="space-y-5">
          <section className="card p-5">
            <h2 className="text-lg font-semibold">{page.find.heading}</h2>
            <form action="/contacts" className="mt-3">
              <label htmlFor="contact-email" className="label">{page.find.emailLabel}</label>
              <div className="flex gap-2">
                <input id="contact-email" name="email" type="email" defaultValue={email} required className="field min-w-0" placeholder={page.find.emailPlaceholder} />
                <button className="btn-secondary">{page.find.button}</button>
              </div>
            </form>
            {email && <div className="mt-3 border-t border-slate-100 pt-3 text-sm" role="status">
              {!found ? page.find.noAccount : found.id === user.id ? page.find.yourself :
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong>{found.name}</strong>
                  {connection ? <span className="text-slate-600">{connection.accepted ? page.find.alreadyContact : connection.requestedBy === user.id ? page.find.invitationSent : page.find.seeIncoming}</span>
                    : <InvitationForm action={inviteAction.bind(null, found.email)}><button className="btn-primary">{page.find.sendRequest}</button></InvitationForm>}
                </div>}
            </div>}
          </section>
          {requests.length > 0 && <section className="card p-5">
            <h2 className="text-lg font-semibold">{page.requests.heading}</h2>
            {(["incoming", "sent"] as const).map((kind) => {
              const list = requests.filter((p) => (p.requestedBy !== user.id) === (kind === "incoming"));
              return list.length > 0 && <div className="mt-3" key={kind}>
                <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">{page.requests[kind]}</h3>
                <ul className="divide-y divide-slate-100">{list.map((p) => <ContactRow key={p.id} person={p} userId={user.id} t={t} />)}</ul>
              </div>;
            })}
          </section>}
          <section className="card p-5">
            <h2 className="text-lg font-semibold">{page.list.heading}</h2>
            {contacts.length ? <ul className="mt-1 divide-y divide-slate-100">{contacts.map((p) => <ContactRow key={p.id} person={p} userId={user.id} t={t} />)}</ul>
              : <p className="mt-2 text-sm text-slate-600">{page.list.empty}</p>}
          </section>
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
