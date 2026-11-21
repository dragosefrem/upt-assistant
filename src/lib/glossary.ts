import type { GlossaryEntry } from "@/i18n/messages/guide";

/** Glossary lookup shared by the Guide page (in the browser) and the assistant (on the server). */

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[().,]/g, " ").replace(/\s+/g, " ").trim();

/**
 * Entries matching a word or abbreviation, best first: an exact headword or alias, then
 * a headword or alias that starts with the query, then any mention in the text.
 */
export function searchGlossary(entries: GlossaryEntry[], query: string): GlossaryEntry[] {
  const q = fold(query);
  if (!q) return entries;
  const scored = entries.flatMap((entry) => {
    const names = [entry.term, ...entry.also].map(fold);
    const words = names.flatMap((n) => n.split(/[\s/]+/));
    let score = 0;
    if (names.includes(q) || words.includes(q)) score = 3;
    else if (q.length >= 2 && [...names, ...words].some((n) => n.startsWith(q) || (q.length >= 4 && q.startsWith(n) && n.length >= 4))) score = 2;
    else if (q.length >= 3 && fold(`${entry.short} ${entry.body}`).includes(q)) score = 1;
    return score ? [{ entry, score }] : [];
  });
  return scored.sort((a, b) => b.score - a.score).map((s) => s.entry);
}
