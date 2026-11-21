import { Check, Clock3, UserRoundPlus } from "lucide-react";
import Form from "next/form";
import Link from "next/link";
import { Fragment } from "react";
import { inviteAction } from "@/app/(app)/contacts/actions";
import { InvitationForm } from "@/components/InvitationForm";
import type { Messages } from "@/i18n/messages";
import { groupParts, MAX_NAME_QUERY, type contactDirectory, type DirectoryPerson } from "@/lib/contact-directory";
import type { contactList } from "@/lib/contacts";
import { capitalize } from "@/lib/time";

type Contact = ReturnType<typeof contactList>[number];
type Directory = ReturnType<typeof contactDirectory>;

export function ContactIdentity({ person, t, showProgramme = true, detailsId }: {
  person: DirectoryPerson; t: Messages; showProgramme?: boolean; detailsId?: string;
}) {
  const find = t.contacts.page.find;
  const { group, subgroup } = groupParts(person.groupName ?? "", person.faculty);
  const details = [
    person.year && capitalize(t.common.time.year(person.year)),
    group && capitalize(t.common.time.group(group)),
    subgroup && find.subgroup(subgroup),
    person.groupName === "" && capitalize(t.common.time.wholeYear),
    person.groupName === null && person.year && find.groupUnset,
    ...(showProgramme ? [person.programme, person.faculty, person.series] : []),
  ].filter(Boolean);
  return <span className="block min-w-0 [overflow-wrap:anywhere]">
    <span className="block text-sm font-semibold text-ink">{person.name}</span>
    <span id={detailsId} className="mt-0.5 block text-xs leading-relaxed text-slate-600">
      {details.length ? details.map((detail, i) => <Fragment key={i}>
        {i > 0 && " · "}<span className="inline-block max-w-full">{detail}</span>
      </Fragment>) : find.studyMissing}
    </span>
  </span>;
}

function directoryHref(scope: string, name = "", page = 1) {
  const params = new URLSearchParams();
  if (scope === "name") params.set("name", name);
  if (scope === "subgroup") params.set("scope", scope);
  if (page > 1) params.set("page", String(page));
  return params.size ? `/contacts?${params}` : "/contacts";
}

function DirectoryAction({ person, connection, userId, t }: {
  person: DirectoryPerson; connection?: Contact; userId: string; t: Messages;
}) {
  const find = t.contacts.page.find;
  const who = <span className="sr-only"> · {person.name}</span>;
  if (!connection) return <InvitationForm action={inviteAction.bind(null, person.id)}>
    <button className="btn-secondary" aria-describedby={`study-${person.id}`}><UserRoundPlus size={16} aria-hidden />{find.sendRequest}{who}</button>
  </InvitationForm>;
  if (!connection.accepted && connection.requestedBy !== userId) {
    return <a className="btn-secondary" href={`#request-${person.id}`} aria-describedby={`study-${person.id}`}>{find.seeIncoming}{who}</a>;
  }
  const Icon = connection.accepted ? Check : Clock3;
  return <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${connection.accepted ? "text-teal-800" : "text-slate-600"}`}>
    <Icon size={16} aria-hidden />{connection.accepted ? find.alreadyContact : find.invitationSent}{who}
  </span>;
}

export function ContactDirectory({ directory, connections, userId, t }: {
  directory: Directory; connections: Contact[]; userId: string; t: Messages;
}) {
  const { name, scope, cohort, people, total, page, pages } = directory;
  const find = t.contacts.page.find;
  const connectionsById = new Map(connections.map((person) => [person.id, person]));
  const scopes = [
    { key: "group", label: find.myGroup, number: cohort?.group },
    ...(cohort?.subgroup ? [{ key: "subgroup", label: find.mySubgroup, number: cohort.subgroup }] : []),
  ];
  let summary = total ? find.classmates(total) : scope === "subgroup" ? find.emptySubgroup : find.emptyGroup;
  if (scope === "name") summary = total ? find.results(total, name) : find.noMatches(name);
  else if (!cohort) summary = find.noGroup;

  return <section className="card min-w-0 p-5" aria-labelledby="directory-heading">
    <h2 id="directory-heading" tabIndex={-1} className="scroll-mt-20 text-lg font-semibold">{find.heading}</h2>
    <Form action="/contacts" scroll={false} role="search" aria-label={find.heading} className="mt-3">
      <label className="label" htmlFor="contact-name">{find.nameLabel}</label>
      <div className="flex gap-2">
        <input key={name} id="contact-name" name="name" type="search" enterKeyHint="search" autoComplete="off"
          maxLength={MAX_NAME_QUERY} className="field min-w-0" defaultValue={name} placeholder={find.namePlaceholder} />
        <button className="btn-primary">{t.common.actions.search}</button>
      </div>
    </Form>
    {cohort && <nav aria-label={find.browse} className="mt-3 flex flex-wrap gap-2">
      {scopes.map(({ key, label, number }) => (
        <Link key={key} href={directoryHref(key)} scroll={false} prefetch={false}
          aria-current={scope === key ? "page" : undefined}
          className="btn-secondary gap-1.5 aria-[current=page]:border-brand-500 aria-[current=page]:bg-brand-50 aria-[current=page]:text-brand-800">
          {label}{number && <span className="font-normal">{number}</span>}
        </Link>
      ))}
    </nav>}
    <div id="contact-results" tabIndex={-1} className="mt-4 scroll-mt-20 border-t border-slate-200 pt-3">
      <p role="status" className="break-words text-sm text-slate-600">{summary}</p>
      {!cohort && scope !== "name" && <Link href="/settings#profile" className="mt-2 inline-block text-sm font-semibold text-brand-700 underline">{find.editProfile}</Link>}
      {people.length > 0 && <ul className="mt-1 divide-y divide-slate-100">
        {people.map((person) => <li key={person.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-3">
          <div className="min-w-0 flex-1 basis-28">
            <ContactIdentity person={person} t={t} showProgramme={scope === "name"} detailsId={`study-${person.id}`} />
          </div>
          <div aria-live="polite" aria-atomic="true">
            <DirectoryAction person={person} connection={connectionsById.get(person.id)} userId={userId} t={t} />
          </div>
        </li>)}
      </ul>}
      {pages > 1 && <nav aria-label={find.pagination} className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
        <span className="text-xs text-slate-600">{find.pageOf(page, pages)}</span>
        <div className="flex gap-1">
          {page > 1 && <Link href={directoryHref(scope, name, page - 1) + "#contact-results"} prefetch={false} className="btn-secondary">{find.previous}</Link>}
          {page < pages && <Link href={directoryHref(scope, name, page + 1) + "#contact-results"} prefetch={false} className="btn-secondary">{t.common.actions.next}</Link>}
        </div>
      </nav>}
    </div>
  </section>;
}
