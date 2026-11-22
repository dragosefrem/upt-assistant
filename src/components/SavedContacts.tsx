"use client";

import { useActionState, useState } from "react";
import { removeSavedContactAction, saveContactAction, type SavedContactResult } from "@/app/(app)/contacts/actions";
import { useT } from "@/i18n/client";
import type { SavedContact } from "@/lib/saved-contacts";

/** "People without an account": names with a group, for the assistant to plan around. */
export function SavedContacts({ people }: { people: SavedContact[] }) {
  const t = useT().contacts.saved;
  const [name, setName] = useState("");
  const [group, setGroup] = useState("");
  const [result, submit, pending] = useActionState(async (previous: SavedContactResult, form: FormData) => {
    const next = await saveContactAction(previous, form);
    if (next.saved) {
      setName("");
      setGroup("");
    }
    return next;
  }, {});
  // Choices belong to the group text they were found for.
  const choices = result.choices && result.query === group.trim() ? result.choices : undefined;

  return (
    <section className="card p-5" aria-labelledby="saved-contacts">
      <h2 id="saved-contacts" className="text-lg font-semibold">{t.heading}</h2>
      <p className="mt-1 text-sm text-slate-600">{t.intro}</p>
      {people.length ? <ul className="mt-2 divide-y divide-slate-100">
        {people.map((person) => <li key={person.id} className="flex items-center justify-between gap-2 py-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold [overflow-wrap:anywhere]">{person.name}</p>
            {person.group ? <p className="text-xs text-slate-600">
              <span className="[overflow-wrap:anywhere]">{person.group.group}</span>
              <span className="ml-1.5 whitespace-nowrap rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600">
                {[person.group.code, person.group.faculty].filter(Boolean).join(" · ")}
              </span>
            </p> : <p className="text-xs text-amber-700">{t.groupGone}</p>}
          </div>
          <form action={removeSavedContactAction.bind(null, person.id)}>
            <button className="btn-ghost" aria-label={t.remove(person.name)} title={t.remove(person.name)}>
              <span aria-hidden>✕</span>
            </button>
          </form>
        </li>)}
      </ul> : <p className="mt-3 text-sm text-slate-500">{t.empty}</p>}
      <form action={submit} aria-busy={pending} className="mt-3 border-t border-slate-100 pt-3">
        <fieldset disabled={pending} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
          <label className="min-w-0">
            <span className="label">{t.nameLabel}</span>
            <input name="name" className="field" required maxLength={60} autoComplete="off" placeholder={t.namePlaceholder}
              value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="min-w-0">
            <span className="label">{t.groupLabel}</span>
            <input name="group" className="field" required autoComplete="off" placeholder={t.groupPlaceholder} aria-describedby="saved-group-hint"
              value={group} onChange={(e) => setGroup(e.target.value)} />
          </label>
          <button className="btn-primary">{t.save}</button>
          <p id="saved-group-hint" className="text-xs text-slate-500 sm:col-span-3">{t.groupHint}</p>
          {choices && <fieldset className="rounded-xl border border-brand-100 bg-brand-50/60 p-3 sm:col-span-3">
            <legend className="px-1 text-sm font-medium text-slate-800">{t.pick(result.query!)}</legend>
            <div className="mt-1 space-y-1">
              {choices.map((choice, i) => <label key={choice.groupId} className="flex cursor-pointer items-baseline gap-2 text-sm">
                <input type="radio" name="groupId" value={choice.groupId} defaultChecked={i === 0} className="accent-brand-600" />
                <span>{choice.group} <span className="text-xs text-slate-500">· {[choice.code, choice.faculty].filter(Boolean).join(" · ")}</span></span>
              </label>)}
            </div>
          </fieldset>}
        </fieldset>
        <div aria-live="polite">
          {result.error && <p role="alert" className="mt-2 text-sm text-red-700">{result.error}</p>}
          {result.saved && <p className="mt-2 text-sm text-teal-800">{t.savedNote(result.saved)}</p>}
        </div>
      </form>
    </section>
  );
}
