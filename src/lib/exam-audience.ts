import type { Locale } from "@/i18n/config";
import { exams } from "@/i18n/messages/exams";

/**
 * Who an exam is for, as a student reads it. Faculty exam lists name the groups ("3.1, 3.2").
 * Campus Virtual names each assessment of a distance-learning course with a label made for its
 * own calendar, "Examen_ALGAD_TST ID_Anul l_Prezentarea 1": all a student needs from it is
 * which of the three sittings of the same exam it is.
 */
/** "Prezentarea 2", or "P2" as the reduced-attendance programmes shorten it ("ED_MN_P1"). */
const SITTING = /(?:prezentarea\s*|(?<![\p{L}\d])p|_p)([123])(?![\p{L}\d])/iu;

export function examAudience(audience: string | null | undefined, locale: Locale): string | null {
  if (!audience) return null;
  const t = exams[locale].card;
  const labels = audience.split(" / ").map((label) => {
    if (!/^(?:examen|ex|ed)_/i.test(label.trim())) return label.trim();
    const sitting = SITTING.exec(label);
    return sitting ? t.sitting(+sitting[1]) : "";
  });
  return [...new Set(labels.filter(Boolean))].join(" / ") || null;
}

/** 1, 2 or 3 when the exam is one sitting of several for the same course; null otherwise. */
export function examSitting(audience: string | null | undefined): number | null {
  const label = audience?.trim() ?? "";
  const sitting = /^(?:examen|ex|ed)_/i.test(label) ? SITTING.exec(label) : null;
  return sitting ? +sitting[1] : null;
}
