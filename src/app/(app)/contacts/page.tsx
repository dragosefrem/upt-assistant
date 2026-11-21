import Link from "next/link";
import { InvitationForm } from "@/components/InvitationForm";
import { InvitationRefresh } from "@/components/InvitationRefresh";
import { eventLabel, responseLabel } from "@/components/GroupEventSummary";
import { requireOnboardedUser } from "@/lib/auth";
import { contactList, findPerson } from "@/lib/contacts";
import { myGroupEvents } from "@/lib/group-events";
import { formatDate, formatMinutes, nowLocal } from "@/lib/time";
import { contactAction, inviteAction } from "./actions";

export const metadata = { title: "Contacts" };

type Contact = ReturnType<typeof contactList>[number];

function ContactRow({ person, userId }: { person: Contact; userId: string }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-3">
      <div className="min-w-0">
        <p className="break-words text-sm font-semibold">{person.name}</p>
        <p className="break-all text-xs text-slate-600">{person.email}</p>
      </div>
      <InvitationForm action={contactAction.bind(null, person.id)} className="flex flex-wrap items-center gap-1">
        {person.accepted ? <button className="btn-ghost" name="action" value="remove">Remove</button>
          : person.requestedBy === userId ? <button className="btn-ghost" name="action" value="cancel">Cancel request</button>
          : <><button className="btn-primary" name="action" value="accept">Accept</button>
            <button className="btn-ghost" name="action" value="decline">Decline</button></>}
      </InvitationForm>
    </li>
  );
}

function EventList({ events }: { events: ReturnType<typeof myGroupEvents> }) {
  return (
    <ul className="divide-y divide-slate-100">
      {events.map((event) => (
        <li key={event.id}>
          <Link className="block rounded-lg py-3 hover:bg-slate-50 focus-visible:outline-brand-500" href={`/contacts/events/${event.id}`}>
            <span className="block text-xs font-medium text-teal-800">{eventLabel(event.status, event.going)} · {event.going} going</span>
            <span className="mt-1 block break-words font-semibold text-brand-700">{event.title}</span>
            <span className="block text-sm text-slate-700">{formatDate(event.date, { weekday: "short", day: "numeric", month: "short" })} · {formatMinutes(event.startMin)}–{formatMinutes(event.endMin)}</span>
            <span className="text-xs text-slate-500">Hosted by {event.host} · {responseLabel[event.response]}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default async function ContactsPage({ searchParams }: PageProps<"/contacts">) {
  const user = await requireOnboardedUser();
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
        <h1 className="text-2xl font-semibold tracking-tight">Contacts</h1>
        <Link className="btn-primary" href="/contacts/plan">Plan a group event</Link>
      </header>
      <div className="grid items-start gap-5 md:grid-cols-2">
        <div className="space-y-5">
          <section className="card p-5">
            <h2 className="text-lg font-semibold">Find a contact</h2>
            <form action="/contacts" className="mt-3">
              <label htmlFor="contact-email" className="label">Account e-mail</label>
              <div className="flex gap-2">
                <input id="contact-email" name="email" type="email" defaultValue={email} required className="field min-w-0" placeholder="name@example.com" />
                <button className="btn-secondary">Find</button>
              </div>
            </form>
            {email && <div className="mt-3 border-t border-slate-100 pt-3 text-sm" role="status">
              {!found ? "No account has that e-mail address." : found.id === user.id ? "This is your account." :
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong>{found.name}</strong>
                  {connection ? <span className="text-slate-600">{connection.accepted ? "Already a contact" : connection.requestedBy === user.id ? "Invitation sent" : "See incoming request below"}</span>
                    : <InvitationForm action={inviteAction.bind(null, found.email)}><button className="btn-primary">Send contact request</button></InvitationForm>}
                </div>}
            </div>}
          </section>
          {requests.length > 0 && <section className="card p-5">
            <h2 className="text-lg font-semibold">Contact requests</h2>
            {["Incoming", "Sent"].map((label) => {
              const list = requests.filter((p) => (p.requestedBy !== user.id) === (label === "Incoming"));
              return list.length > 0 && <div className="mt-3" key={label}>
                <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</h3>
                <ul className="divide-y divide-slate-100">{list.map((p) => <ContactRow key={p.id} person={p} userId={user.id} />)}</ul>
              </div>;
            })}
          </section>}
          <section className="card p-5">
            <h2 className="text-lg font-semibold">Your contacts</h2>
            {contacts.length ? <ul className="mt-1 divide-y divide-slate-100">{contacts.map((p) => <ContactRow key={p.id} person={p} userId={user.id} />)}</ul>
              : <p className="mt-2 text-sm text-slate-600">Accepted contacts appear here. You can also plan an event and invite guests with a link.</p>}
          </section>
        </div>
        <section className="card p-5">
          <h2 className="text-lg font-semibold">Group invitations</h2>
          {upcoming.length ? <EventList events={upcoming} /> : <p className="mt-2 text-sm text-slate-600">You have no upcoming group invitations.</p>}
          {past.length > 0 && <details className="mt-4 border-t border-slate-200 pt-3">
            <summary className="cursor-pointer text-sm font-medium">Past invitations ({past.length})</summary>
            <EventList events={past} />
          </details>}
        </section>
      </div>
    </div>
  );
}
