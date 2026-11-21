import { admin } from "./admin";
import { assistant } from "./assistant";
import { attendance } from "./attendance";
import { auth } from "./auth";
import { calendar } from "./calendar";
import { campus } from "./campus";
import { common } from "./common";
import { contacts } from "./contacts";
import { exams } from "./exams";
import { guide } from "./guide";
import { landing } from "./landing";
import { onboarding } from "./onboarding";
import { settings } from "./settings";
import { study } from "./study";

/**
 * Every text the interface shows, in each language. One file per area of the app; the
 * Romanian object in each file is typed against the English one, so a missing or
 * misspelt key fails the type check.
 *
 * Server components: `const t = await getT()` (src/i18n/server.ts).
 * Client components: `const t = useT()` (src/i18n/client.tsx).
 */
export const messages = {
  en: {
    admin: admin.en,
    assistant: assistant.en,
    attendance: attendance.en,
    auth: auth.en,
    calendar: calendar.en,
    campus: campus.en,
    common: common.en,
    contacts: contacts.en,
    exams: exams.en,
    guide: guide.en,
    landing: landing.en,
    onboarding: onboarding.en,
    settings: settings.en,
    study: study.en,
  },
  ro: {
    admin: admin.ro,
    assistant: assistant.ro,
    attendance: attendance.ro,
    auth: auth.ro,
    calendar: calendar.ro,
    campus: campus.ro,
    common: common.ro,
    contacts: contacts.ro,
    exams: exams.ro,
    guide: guide.ro,
    landing: landing.ro,
    onboarding: onboarding.ro,
    settings: settings.ro,
    study: study.ro,
  },
};

export type Messages = (typeof messages)["en"];
