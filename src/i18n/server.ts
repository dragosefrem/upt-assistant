import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { LOCALE_COOKIE, isLocale, pickLocale, type Locale } from "./config";
import { messages, type Messages } from "./messages";

/** The language for this request: the visitor's choice, else what their browser asks for. */
export const getLocale = cache(async (): Promise<Locale> => {
  const chosen = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(chosen)) return chosen;
  return pickLocale((await headers()).get("accept-language"));
});

/** The interface texts for this request. Usage: `const t = await getT(); t.common.save`. */
export async function getT(): Promise<Messages> {
  return messages[await getLocale()];
}

/** Texts in a known language, for work outside a request (e-mails, background jobs). */
export function messagesFor(locale: Locale): Messages {
  return messages[locale];
}
