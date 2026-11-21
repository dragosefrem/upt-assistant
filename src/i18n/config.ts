/**
 * Languages the interface speaks. Safe to import from client and server code.
 * Romanian is the default: the app is for students of a Romanian university.
 */
export const LOCALES = ["ro", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "ro";

/** Cookie that remembers the chosen language (also for signed-out visitors). */
export const LOCALE_COOKIE = "upt_lang";

/** BCP 47 tags used for dates, numbers and speech. */
export const DATE_LOCALE: Record<Locale, string> = { ro: "ro-RO", en: "en-GB" };

export const LOCALE_NAMES: Record<Locale, string> = { ro: "Română", en: "English" };

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** The first supported language in an Accept-Language header, else the default. */
export function pickLocale(acceptLanguage: string | null | undefined): Locale {
  for (const part of (acceptLanguage ?? "").split(",")) {
    const tag = part.split(";")[0].trim().toLowerCase().slice(0, 2);
    if (isLocale(tag)) return tag;
  }
  return DEFAULT_LOCALE;
}

/**
 * Picks the grammatical form for a count. Romanian has three: "1 curs", "2 cursuri",
 * "20 de cursuri"; English uses `one` and `other` (pass the plural as both `few` and `other`).
 */
export function plural(locale: Locale, n: number, forms: { one: string; few: string; other: string }): string {
  const category = new Intl.PluralRules(DATE_LOCALE[locale]).select(n);
  return category === "one" ? forms.one : category === "few" ? forms.few : forms.other;
}
