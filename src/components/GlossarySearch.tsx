"use client";

import { useState } from "react";
import { useT } from "@/i18n/client";
import { searchGlossary } from "@/lib/glossary";

/** The glossary with a search box: type a word or an abbreviation from the timetable. */
export function GlossarySearch() {
  const t = useT().guide;
  const [query, setQuery] = useState("");
  const found = searchGlossary(t.entries, query);
  return (
    <div>
      <label className="sr-only" htmlFor="glossary-search">{t.glossary.searchLabel}</label>
      <input
        id="glossary-search"
        type="search"
        className="field mb-4 max-w-md"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t.glossary.search}
        autoComplete="off"
      />
      {found.length ? (
        <dl className="grid gap-3 md:grid-cols-2">
          {found.map((e) => (
            <div key={e.id} id={`term-${e.id}`} className="scroll-mt-24 rounded-2xl border border-slate-200 bg-white p-4">
              <dt className="text-base font-semibold text-slate-900" lang="ro">{e.term}</dt>
              <dd className="mt-0.5 text-sm font-medium text-brand-700">{e.short}</dd>
              <dd className="mt-1.5 text-sm leading-relaxed text-slate-600">{e.body}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-sm text-slate-600" role="status">{t.glossary.none(query)}</p>
      )}
    </div>
  );
}
