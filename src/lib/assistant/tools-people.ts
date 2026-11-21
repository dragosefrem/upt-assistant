import "server-only";
import { InvitationError, answerContact, cancelContactRequest, contactList, inviteContact, removeContact } from "../contacts";
import { isEmail } from "../export-email";
import { myGroupEvents, respondToEvent } from "../group-events";
import { createGroupEvent } from "../group-planning";
import { availabilityAt, listPeople, matchPeople, ownBusyAt, personBusy, personGroup, type Person } from "../people";
import { removeSavedContact } from "../saved-contacts";
import { describeGroup, findGroups, ownCohort } from "../schedule";
import { DAY_NAMES, addDays, formatMinutes, nowLocal, weekday } from "../time";
import { addLink, dated, fold, isDate, num, parseClock, span, str, strList, type AssistantTool, type ToolContext } from "./toolkit";

/** Tools about other people: contacts, who is free when, and group events. */

/** A group named directly ("TI 3.2") stands in for "someone from that group". */
function groupAsPerson(query: string, ctx: ToolContext): Person | null {
  if (!/\d/.test(query)) return null;
  const [match] = findGroups(query, ctx.user.facultyId, ctx.user.year, 1, ownCohort(ctx.user));
  const found = match ?? (ctx.user.facultyId ? findGroups(query, null, ctx.user.year, 1)[0] : undefined);
  const info = found ? describeGroup(found.group.id) : null;
  return info ? { kind: "saved", id: -info.group.id, name: `${info.spec.code ?? info.spec.name} ${info.label} (group)`, groupId: info.group.id } : null;
}

export interface ResolvedPeople {
  people: Person[];
  unknown: string[];
  ambiguous: Array<{ asked: string; matches: string[] }>;
}

/** Turns the names the student used into contacts; a name that fits several people is reported, not guessed. */
export function resolvePeople(ctx: ToolContext, names: string[]): ResolvedPeople {
  const all = listPeople(ctx.user.id);
  const out: ResolvedPeople = { people: [], unknown: [], ambiguous: [] };
  for (const name of names) {
    const hits = matchPeople(all, name);
    if (hits.length === 1) out.people.push(hits[0]);
    else if (hits.length > 1) out.ambiguous.push({ asked: name, matches: hits.map((p) => `${p.name}${personGroup(p) ? ` (${personGroup(p)})` : ""}`) });
    else {
      const group = groupAsPerson(name, ctx);
      if (group) out.people.push(group);
      else out.unknown.push(name);
    }
  }
  // The same person named twice counts once.
  out.people = out.people.filter((p, i, list) => list.findIndex((o) => o.kind === p.kind && o.id === p.id) === i);
  return out;
}

const describePerson = (p: Person) => ({
  name: p.name,
  group: personGroup(p),
  availability_from: p.kind === "account" ? "their own calendar (linked account)" : "their group's published timetable",
});

function failure(error: unknown) {
  if (error instanceof InvitationError) return { error: error.message };
  throw error;
}

export const PEOPLE_TOOLS: AssistantTool[] = [
  {
    name: "list_contacts",
    description:
      "The student's contacts: linked accounts (they accepted each other, so real calendars count), contact requests waiting for an answer or sent, and saved people (a name plus a group, for friends without an account). Use it for \"who are my contacts?\" and before acting on a contact by name.",
    input_schema: { type: "object", properties: {} },
    run(_input, { user }) {
      const accounts = contactList(user.id);
      const people = listPeople(user.id);
      return {
        linked_accounts: people.filter((p) => p.kind === "account").map((p) => ({ name: p.name, group: personGroup(p) })),
        requests_to_answer: accounts.filter((c) => !c.accepted && c.requestedBy !== user.id).map((c) => ({ name: c.name, email: c.email })),
        requests_sent: accounts.filter((c) => !c.accepted && c.requestedBy === user.id).map((c) => ({ name: c.name, email: c.email })),
        saved_people: people.filter((p) => p.kind === "saved").map((p) => ({ name: p.name, group: personGroup(p) ?? "group no longer in the timetable" })),
        note: people.length ? undefined : "No contacts yet. The student can invite someone by e-mail (invite_contact) or tell you a friend's group (save_contact).",
      };
    },
  },
  {
    name: "who_is_free",
    description:
      "Checks who is free during one time slot on one date: the student's contacts (all of them, or the ones named) and the student themselves. Use it for \"which of my contacts are free Thursday 14 to 16?\" and \"are Ana and Mihai free tomorrow at 10?\". A linked account is checked against that person's real calendar; a saved person or a group (\"TI 3.2\") against the group's published timetable. To FIND a time that suits people, use find_meeting_slots instead.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", format: "date", description: "YYYY-MM-DD." },
        start: { type: "string", description: "HH:MM." },
        end: { type: "string", description: "HH:MM. Default one hour after `start`." },
        people: { type: "array", items: { type: "string" }, description: "Names of contacts, or groups such as \"TI 3.2\". Leave out to check every contact." },
      },
      required: ["date", "start"],
    },
    run(input, ctx) {
      if (!isDate(input.date)) return { error: "date must be YYYY-MM-DD." };
      const startMin = parseClock(input.start);
      const endMin = parseClock(input.end) ?? (startMin !== undefined ? Math.min(startMin + 60, 24 * 60) : undefined);
      if (startMin === undefined || endMin === undefined || endMin <= startMin) return { error: "Give a valid start and end, HH:MM." };
      const names = strList(input.people);
      const resolved = names.length ? resolvePeople(ctx, names) : { people: listPeople(ctx.user.id), unknown: [], ambiguous: [] };
      if (!resolved.people.length && !resolved.ambiguous.length) {
        return names.length
          ? { error: `None of these is a contact or a group: ${resolved.unknown.join(", ")}.`, hint: "Ask which group each person is in and store it with save_contact, or have the student invite them by e-mail with invite_contact." }
          : { error: "The student has no contacts yet.", hint: "They can invite someone by e-mail (invite_contact) or tell you a friend's group (save_contact)." };
      }
      const checked = availabilityAt(resolved.people, input.date, startMin, endMin);
      const own = ownBusyAt(ctx.user, input.date, startMin, endMin);
      const free = checked.filter((a) => a.free);
      const busy = checked.filter((a) => a.known && !a.free);
      return {
        slot: `${dated(input.date)} ${span(startMin, endMin)}`,
        you: own.length ? { free: false, busy_with: own.map((b) => `${b.what} ${span(b.startMin, b.endMin)}`) } : { free: true },
        free: free.map((a) => describePerson(a.person)),
        busy: busy.map((a) => ({
          ...describePerson(a.person),
          busy_with: a.busy.map((b) => `${b.what ?? "busy"} ${span(b.startMin, b.endMin)}`),
        })),
        cannot_tell: checked.filter((a) => !a.known).map((a) => `${a.person.name} (their group is no longer in the timetable)`),
        not_a_contact: resolved.unknown.length ? resolved.unknown : undefined,
        several_people_match: resolved.ambiguous.length ? resolved.ambiguous : undefined,
        everyone_free: !own.length && busy.length === 0 && checked.every((a) => a.known) && !resolved.unknown.length && !resolved.ambiguous.length,
        caveat: resolved.people.some((p) => p.kind === "saved")
          ? "For saved people and groups only the published timetable is known; they may have other plans."
          : undefined,
      };
    },
  },
  {
    name: "contact_schedule",
    description:
      "What one contact has on a day or over a few days: \"what does Mihai have on Monday?\", \"when does Ana finish tomorrow?\". For a linked account it is their real calendar, with classes and exams by name and everything else as busy time (their private events are never named); for a saved person or a group it is the group's published timetable.",
    input_schema: {
      type: "object",
      properties: {
        person: { type: "string", description: "The contact's name, or a group such as \"TI 3.2\"." },
        from: { type: "string", format: "date", description: "First day, YYYY-MM-DD." },
        to: { type: "string", format: "date", description: "Last day, YYYY-MM-DD. Defaults to `from`; at most 7 days after it." },
      },
      required: ["person", "from"],
    },
    run(input, ctx) {
      const name = str(input.person);
      if (!name || !isDate(input.from)) return { error: "A person and a first day (YYYY-MM-DD) are needed." };
      let to = isDate(input.to) && input.to >= input.from ? input.to : input.from;
      if (to > addDays(input.from, 7)) to = addDays(input.from, 7);
      const resolved = resolvePeople(ctx, [name]);
      if (resolved.ambiguous.length) return { error: "Several contacts match; ask which one.", several_people_match: resolved.ambiguous };
      const [person] = resolved.people;
      if (!person) return { error: `"${name}" is not a contact or a group.`, hint: "See list_contacts. A friend's group can be stored with save_contact." };
      const busy = personBusy(person, input.from, to).sort((a, b) => a.date.localeCompare(b.date) || a.startMin - b.startMin);
      return {
        ...describePerson(person),
        from: input.from,
        to,
        busy: busy.map((b) => ({ date: b.date, weekday: DAY_NAMES[weekday(b.date)], time: span(b.startMin, b.endMin), what: b.what ?? "busy" })),
        note: busy.length ? undefined : "Nothing in that period.",
      };
    },
  },
  {
    name: "invite_contact",
    description:
      "Prepare a contact request to an address the student gave. Ask them to confirm that address and calendar sharing, then call again with confirmed: true to send it.",
    input_schema: { type: "object", properties: { email: { type: "string" }, confirmed: { type: "boolean" } }, required: ["email"] },
    run(input, ctx) {
      const email = str(input.email);
      if (!email || !isEmail(email)) return { error: "A valid e-mail address is needed." };
      if (input.confirmed !== true) return {
        needs_confirmation: "Ask whether to send this contact request. If they accept, both students can see each other's classes, exams and busy times. Call again with confirmed: true only after a yes.",
        recipient: email,
      };
      try {
        inviteContact(ctx.user.id, email);
      } catch (error) {
        return failure(error);
      }
      ctx.changed = true;
      return { request_sent_to: email, note: "They see the request on their Contacts page and must accept it." };
    },
  },
  {
    name: "answer_contact_request",
    description: "Accept or decline an incoming contact request by name or e-mail. Accepting shares both timetables. Show the sender, ask first and pass confirmed: true only after a yes. Declining is one step.",
    input_schema: {
      type: "object",
      properties: { person: { type: "string", description: "Name or e-mail of the sender." }, accept: { type: "boolean" }, confirmed: { type: "boolean" } },
      required: ["person", "accept"],
    },
    run(input, ctx) {
      const q = fold(str(input.person) ?? "");
      if (!q || typeof input.accept !== "boolean") return { error: "Say whose request and whether to accept it." };
      const incoming = contactList(ctx.user.id).filter((c) => !c.accepted && c.requestedBy !== ctx.user.id);
      const hits = incoming.filter((c) => fold(c.name).includes(q) || fold(c.email) === q);
      if (!hits.length) return { error: "No waiting request from that person.", waiting: incoming.map((c) => c.name) };
      if (hits.length > 1) return { error: "Several requests match; ask which one.", candidates: hits.map((c) => `${c.name} (${c.email})`) };
      if (input.accept && input.confirmed !== true) return {
        needs_confirmation: "Ask whether to accept and share classes, exams and busy times with this person. Call again with confirmed: true only after a yes.",
        sender: { name: hits[0].name, email: hits[0].email },
      };
      answerContact(ctx.user.id, hits[0].id, input.accept);
      ctx.changed = true;
      return { [input.accept ? "accepted" : "declined"]: hits[0].name };
    },
  },
  {
    name: "remove_contact",
    description:
      "Removes a contact: a linked account (both stop seeing each other's timetable), a request the student sent that is still waiting, or a saved person. Removing a linked account needs confirmed: true, after the student said yes.",
    input_schema: {
      type: "object",
      properties: { person: { type: "string", description: "The contact's name." }, confirmed: { type: "boolean" } },
      required: ["person"],
    },
    run(input, ctx) {
      const name = str(input.person);
      if (!name) return { error: "Say which contact." };
      const q = fold(name);
      const pendingOut = contactList(ctx.user.id).filter((c) => !c.accepted && c.requestedBy === ctx.user.id && (fold(c.name).includes(q) || fold(c.email) === q));
      const hits = matchPeople(listPeople(ctx.user.id), name);
      if (hits.length + pendingOut.length > 1) {
        return { error: "Several contacts match; ask which one.", candidates: [...hits.map((p) => `${p.name} (${p.kind === "account" ? "linked account" : "saved person"})`), ...pendingOut.map((c) => `${c.name} (request sent)`)] };
      }
      if (pendingOut.length) {
        cancelContactRequest(ctx.user.id, pendingOut[0].id);
        ctx.changed = true;
        return { request_cancelled: pendingOut[0].name };
      }
      const [person] = hits;
      if (!person) return { error: `No contact called "${name}".` };
      if (person.kind === "saved") {
        removeSavedContact(ctx.user.id, person.id);
        ctx.changed = true;
        return { removed_saved_person: person.name };
      }
      if (input.confirmed !== true) return { needs_confirmation: `Remove ${person.name} from the student's contacts? Both will stop seeing each other's timetable.`, note: "Ask the student; if yes, call again with confirmed: true." };
      removeContact(ctx.user.id, person.id);
      ctx.changed = true;
      return { removed_contact: person.name };
    },
  },
  {
    name: "list_group_events",
    description:
      "Group events the student organises or is invited to, with date, time, host, how many are going, whether the event is pending / confirmed / expired, and the student's own answer. Use it for \"do I have any invitations?\".",
    input_schema: { type: "object", properties: { include_past: { type: "boolean", description: "Also events before today. Default false." } } },
    run(input, { user }) {
      const today = nowLocal().date;
      const events = myGroupEvents(user.id).filter((e) => input.include_past === true || e.date >= today);
      return {
        events: events.map((e) => ({
          title: e.title,
          when: `${dated(e.date)} ${span(e.startMin, e.endMin)}`,
          location: e.location,
          organised_by: e.creatorId === user.id ? "the student" : e.host,
          status: e.status,
          going: e.going,
          your_answer: e.response,
          page: `/contacts/events/${e.id}`,
        })),
        waiting_for_your_answer: events.filter((e) => e.response === "pending" && e.status !== "expired").map((e) => e.title),
      };
    },
  },
  {
    name: "respond_group_event",
    description: "Answers a group event invitation for the student: going or not going. Identify the event by its title (see list_group_events); the answer can be changed later the same way.",
    input_schema: {
      type: "object",
      properties: { event: { type: "string", description: "Title (or part of it) of the event." }, going: { type: "boolean" } },
      required: ["event", "going"],
    },
    run(input, ctx) {
      const q = fold(str(input.event) ?? "");
      if (!q || typeof input.going !== "boolean") return { error: "Say which event and whether the student is going." };
      const today = nowLocal().date;
      const hits = myGroupEvents(ctx.user.id).filter((e) => e.date >= today && fold(e.title).includes(q));
      if (!hits.length) return { error: "No upcoming group event with that title." };
      if (hits.length > 1) return { error: "Several events match; ask which one.", candidates: hits.map((e) => `${e.title} — ${dated(e.date)} ${span(e.startMin, e.endMin)}`) };
      const [event] = hits;
      try {
        respondToEvent({ eventId: event.id }, { userId: ctx.user.id }, input.going ? "accepted" : "declined");
      } catch (error) {
        return failure(error);
      }
      ctx.changed = true;
      addLink(ctx, event.title, `/contacts/events/${event.id}`);
      return { event: event.title, when: `${dated(event.date)} ${span(event.startMin, event.endMin)}`, your_answer: input.going ? "going" : "not going" };
    },
  },
  {
    name: "create_group_event",
    description:
      "Creates a group event and invites linked-account contacts to it (they answer going / not going; it is confirmed when everyone accepts, or at the reply deadline if at least two are going). Use find_meeting_slots or who_is_free first to pick a time everyone has free. Without `confirmed` nothing is created: you get a summary to read back. Invitations go to other people, so only pass confirmed: true after the student said yes. People without an account cannot be invited directly; set guest_link so the student can share a link with them.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        date: { type: "string", format: "date", description: "YYYY-MM-DD." },
        start: { type: "string", description: "HH:MM." },
        duration_minutes: { type: "number", description: "Default 60." },
        people: { type: "array", items: { type: "string" }, description: "Names of linked-account contacts to invite." },
        location: { type: "string" },
        reply_by: { type: "string", description: "Deadline for answers, \"YYYY-MM-DD HH:MM\". Default: 24 hours before the start, or one hour before if it is sooner than that." },
        guest_link: { type: "boolean", description: "Also create a link people without an account can use to join." },
        confirmed: { type: "boolean", description: "Create it and send the invitations. Only after the student said yes." },
      },
      required: ["title", "date", "start"],
    },
    run(input, ctx) {
      const title = str(input.title)?.slice(0, 120);
      const startMin = parseClock(input.start);
      const duration = Math.round(num(input.duration_minutes) ?? 60);
      if (!title || !isDate(input.date) || startMin === undefined) return { error: "A title, a date and a start time are needed." };
      if (duration < 15 || startMin + duration > 24 * 60) return { error: "The event must end by midnight and last at least 15 minutes." };
      const endMin = startMin + duration;
      const resolved = resolvePeople(ctx, strList(input.people));
      if (resolved.ambiguous.length) return { error: "Several contacts match a name; ask which one.", several_people_match: resolved.ambiguous };
      const invitees = resolved.people.filter((p): p is Extract<Person, { kind: "account" }> => p.kind === "account");
      const noAccount = [...resolved.people.filter((p) => p.kind === "saved").map((p) => p.name), ...resolved.unknown];
      const share = input.guest_link === true || (noAccount.length > 0 && input.guest_link !== false);
      if (!invitees.length && !share) return { error: "Name at least one linked-account contact to invite, or set guest_link to share a link.", cannot_invite_directly: noAccount.length ? noAccount : undefined };

      const now = nowLocal();
      const stamp = (date: string, minutes: number) => `${date}T${formatMinutes(minutes)}`;
      const startStamp = stamp(input.date, startMin);
      const nowStamp = stamp(now.date, now.minutes);
      const given = typeof input.reply_by === "string" ? /^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}:\d{2})$/.exec(input.reply_by.trim()) : null;
      const givenMin = given ? parseClock(given[2]) : undefined;
      const dayBefore = stamp(addDays(input.date, -1), startMin);
      const hourBefore = startMin >= 60 ? stamp(input.date, startMin - 60) : startStamp;
      const deadline = given && givenMin !== undefined ? stamp(given[1], givenMin) : dayBefore > nowStamp ? dayBefore : hourBefore > nowStamp ? hourBefore : startStamp;

      const availability = availabilityAt(invitees, input.date, startMin, endMin);
      const own = ownBusyAt(ctx.user, input.date, startMin, endMin);
      const summary = {
        title,
        when: `${dated(input.date)} ${span(startMin, endMin)}`,
        location: str(input.location) ?? null,
        inviting: invitees.map((p) => p.name),
        cannot_invite_directly: noAccount.length ? noAccount : undefined,
        guest_link: share,
        reply_by: deadline.replace("T", " "),
        busy_then: [
          ...(own.length ? [`the student (${own.map((b) => b.what).join(", ")})`] : []),
          ...availability.filter((a) => !a.free).map((a) => a.person.name),
        ],
      };
      if (input.confirmed !== true) {
        return {
          not_created_yet: summary,
          note: summary.busy_then.length
            ? "Someone is busy at that time, so it cannot be booked as is: propose another time with find_meeting_slots."
            : "Read this back in one or two sentences and ask the student to confirm; then call again with the same details and confirmed: true.",
        };
      }
      let id: string;
      try {
        id = createGroupEvent(ctx.user, {
          contactIds: invitees.map((p) => p.id),
          title,
          location: str(input.location) ?? "",
          date: input.date,
          startMin,
          duration,
          deadline,
          share,
        });
      } catch (error) {
        return failure(error);
      }
      ctx.changed = true;
      addLink(ctx, title, `/contacts/events/${id}`);
      return {
        created: summary,
        page: `/contacts/events/${id}`,
        note: share
          ? "Invitations were sent. The event page (button under your reply) has the guest link to share with people who have no account."
          : "Invitations were sent; the student counts as going. The event page is linked under your reply.",
      };
    },
  },
];
