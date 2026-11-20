import * as cheerio from "cheerio";
import type { Degree } from "@/db/schema";
import { fetchText } from "./http";
import { slugify, squash } from "./text";

/**
 * Scrapes the university structure from upt.ro: faculties, the bachelor domains and
 * master's programmes each one offers, and (per bachelor domain) its specializations.
 */

const BASE = "https://www.upt.ro";
const HUB = `${BASE}/studenti/calendar-orare`;
const LISTINGS: Array<{ degree: Degree; url: string }> = [
  { degree: "bachelor", url: `${BASE}/educatie/licenta/facultati-si-domenii` },
  { degree: "master", url: `${BASE}/educatie/masterat/facultati-si-programe` },
];

export interface CatalogSpecialization {
  degree: Degree;
  name: string;
  domain: string | null;
  language: string | null;
  durationYears: number | null;
  url: string;
}

export interface CatalogFaculty {
  slug: string;
  name: string;
  shortName: string | null;
  website: string | null;
  scheduleUrl: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  specializations: CatalogSpecialization[];
}

export interface Catalog {
  faculties: CatalogFaculty[];
  warnings: string[];
}

/** "Calculatoare și tehnologia informației, 4 ani, RO" → name, duration, language. */
export function parseProgrammeLabel(label: string) {
  const parts = squash(label.replace(/->\s*$/, "")).split(",").map((p) => p.trim());
  let durationYears: number | null = null;
  const langs: string[] = [];
  const nameParts: string[] = [];
  for (const part of parts) {
    const years = /^(\d)\s*(?:ani|an|years?)$/i.exec(part);
    if (years) durationYears = +years[1];
    else if (/^(RO|EN|DE|FR|ID|IFR)(\/(RO|EN|DE|FR))*$/i.test(part)) langs.push(part.toUpperCase());
    else nameParts.push(part);
  }
  return { name: nameParts.join(", "), durationYears, language: langs.join(", ") || null };
}

function mainLinks(html: string): Array<{ href: string; text: string }> {
  const $ = cheerio.load(html);
  const scope = $("main").length ? $("main") : $("body");
  return scope
    .find("a[href]")
    .map((_, a) => ({ href: $(a).attr("href") ?? "", text: squash($(a).text()) }))
    .get();
}

async function scrapeSpecializations(url: string): Promise<string[]> {
  const { text: html } = await fetchText(url);
  return extractSpecializations(html);
}

/**
 * A domain page has a "Specializare" section: a sentence ending in "…aceste
 * specializări:" followed by one card per specialization (plain nested divs).
 */
export function extractSpecializations(html: string): string[] {
  const $ = cheerio.load(html);
  const heading = $("h2, h3")
    .filter((_, el) => /^specializ[aă]r/i.test(squash($(el).text())))
    .first();
  if (!heading.length) return [];
  const section = heading.parent().parent();
  const names = section
    .find("div, li")
    .filter((_, el) => $(el).children().length === 0)
    .map((_, el) => squash($(el).text()))
    .get()
    .filter((n) => n.length > 2 && n.length < 120);
  return [...new Set(names)];
}

export async function scrapeCatalog(log: (line: string) => void = () => {}): Promise<Catalog> {
  const warnings: string[] = [];
  const byPath = new Map<string, CatalogFaculty>();

  for (const listing of LISTINGS) {
    const { text: html } = await fetchText(listing.url);
    const prefix = new URL(listing.url).pathname;
    for (const { href, text } of mainLinks(html)) {
      if (!href.startsWith(`${prefix}/`)) continue;
      const rest = href.slice(prefix.length + 1).split("/").filter(Boolean);
      if (!rest.length) continue;
      const facultySlug = rest[0];
      if (rest.length === 1) {
        if (!byPath.has(facultySlug)) {
          byPath.set(facultySlug, {
            slug: facultySlug,
            name: squash(text.replace(/->\s*$/, "")),
            shortName: null,
            website: null,
            scheduleUrl: null,
            address: null,
            lat: null,
            lng: null,
            specializations: [],
          });
        }
        continue;
      }
      const faculty = byPath.get(facultySlug);
      if (!faculty) continue;
      const parsed = parseProgrammeLabel(text);
      if (!parsed.name) continue;
      faculty.specializations.push({
        degree: listing.degree,
        name: parsed.name,
        domain: listing.degree === "bachelor" ? parsed.name : null,
        language: parsed.language,
        durationYears: parsed.durationYears,
        url: new URL(href, BASE).toString(),
      });
    }
    log(`Catalog: read ${listing.degree} programmes from ${listing.url}`);
  }

  // Bachelor domains split into specializations in later years; list those too.
  for (const faculty of byPath.values()) {
    const domains = faculty.specializations.filter((s) => s.degree === "bachelor");
    for (const domain of domains) {
      try {
        const names = await scrapeSpecializations(domain.url);
        for (const name of names) {
          if (slugify(name) === slugify(domain.name)) continue;
          faculty.specializations.push({ ...domain, name, domain: domain.name });
        }
      } catch (err) {
        warnings.push(`Could not read specializations of "${domain.name}": ${(err as Error).message}`);
      }
    }
  }

  // Faculty details: website, address and coordinates from the faculty's own page.
  for (const faculty of byPath.values()) {
    try {
      const { text: html } = await fetchText(`${BASE}/structura/${faculty.slug}`);
      const $ = cheerio.load(html);
      const scope = $("main").length ? $("main") : $("body");
      scope.find("a[href]").each((_, a) => {
        const href = $(a).attr("href") ?? "";
        const maps = /google\.[a-z.]+\/maps\/search\/\?api=1&(?:amp;)?query=([-\d.]+)(?:%2C|,)(?:%20|\s)*([-\d.]+)/i.exec(href);
        if (maps) {
          faculty.lat = +maps[1];
          faculty.lng = +maps[2];
          const block = squash($(a).closest("div").parent().text());
          const addr = /((?:Bd\.|Bv\.|Str\.|Strada|Pia[tţț]a|P-[tţț]a)[^|]{5,90}?(?:Timi[sşș]oara|Hunedoara))/i.exec(block);
          if (addr) faculty.address = squash(addr[1]);
        } else if (!faculty.website && /^https?:\/\/[a-z0-9.-]*upt\.ro\/?$/i.test(href) && !/www\.upt\.ro/.test(href)) {
          faculty.website = href.replace(/\/$/, "");
        }
      });
    } catch (err) {
      warnings.push(`Could not read details of ${faculty.name}: ${(err as Error).message}`);
    }
  }

  // The student hub links every faculty to its timetable page and gives its acronym:
  // "Orare pentru Facultatea de Automatică și Calculatoare (AC)".
  try {
    const { text: html } = await fetchText(HUB);
    for (const { href, text } of mainLinks(html)) {
      const m = /Orare pentru (Facultatea [^()]+?)\s*\(([^)]+)\)/i.exec(text);
      if (!m) continue;
      const target = slugify(m[1]);
      const faculty = [...byPath.values()].find((f) => slugify(f.name) === target);
      if (faculty) {
        faculty.scheduleUrl = href;
        faculty.shortName = m[2].trim();
      } else {
        warnings.push(`Timetable link for unknown faculty "${m[1]}"`);
      }
    }
  } catch (err) {
    warnings.push(`Could not read the timetable hub page: ${(err as Error).message}`);
  }

  log(`Catalog: ${byPath.size} faculties, ${[...byPath.values()].reduce((n, f) => n + f.specializations.length, 0)} programmes`);
  return { faculties: [...byPath.values()], warnings };
}
