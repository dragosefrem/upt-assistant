import * as cheerio from "cheerio";
import type { SourceFormat, SourceKind } from "@/db/schema";
import { squash, stripDiacritics } from "./text";
import type { DiscoveredSource, PageLink, SemesterRef } from "./types";

/**
 * Generic link discovery for faculty "orare"/"examene" pages. Each link is paired with
 * the nearest preceding heading-like text, because that is where pages say which
 * semester and academic year a document belongs to.
 */

const CONTEXT_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "p", "strong", "b", "li", "td", "th", "summary", "span", "div"]);
const CONTEXT_RE = /semestr|sesiun|an(?:ul)?\s+univ|20\d\d\s*[-–\/]\s*(?:20)?\d\d|licen[tţț][aă]|master|orar/i;

export function extractLinks(html: string, baseUrl: string): PageLink[] {
  const $ = cheerio.load(html);
  $("script, style, noscript, nav, header, footer").remove();
  const links: PageLink[] = [];
  let context = "";
  $("body *").each((_, el) => {
    const tag = el.tagName?.toLowerCase();
    if (!tag) return;
    if (tag === "a") {
      const href = $(el).attr("href");
      if (!href || href.startsWith("#") || /^(mailto|tel|javascript):/i.test(href)) return;
      let url: string;
      try {
        url = new URL(href, baseUrl).toString();
      } catch {
        return;
      }
      links.push({ url, label: squash($(el).text()), context });
      return;
    }
    if (!CONTEXT_TAGS.has(tag)) return;
    // Only text that belongs to this element itself, not to links nested inside it.
    const own = squash(
      $(el)
        .contents()
        .filter((__, node) => node.type === "text")
        .text(),
    );
    if (own.length >= 6 && own.length <= 220 && CONTEXT_RE.test(own)) context = own;
  });
  return links;
}

export function detectAcademicYear(text: string): string | null {
  const t = text.replace(/%20|_/g, " ");
  const long = /(20\d\d)\s*[-–\/]\s*(20\d\d)/.exec(t);
  if (long && +long[2] === +long[1] + 1) return `${long[1]}-${long[2]}`;
  const short = /(?<!\d)(20\d\d)\s*[-–\/]\s*(\d\d)(?!\d)/.exec(t);
  if (short && +short[2] === (+short[1] + 1) % 100) return `${short[1]}-20${short[2]}`;
  const tiny = /(?<![\d.])(\d\d)\s*[-–]\s*(\d\d)(?![\d.:])/.exec(t);
  if (tiny && +tiny[2] === +tiny[1] + 1 && +tiny[1] >= 20 && +tiny[1] <= 60) return `20${tiny[1]}-20${tiny[2]}`;
  return null;
}

export function detectSemester(text: string): number | null {
  const t = stripDiacritics(text).replace(/%20|_/g, " ");
  const m =
    /sem(?:estrul)?\.?\s*(?:al\s+)?(II|I|2|1)(?![\dIV])/i.exec(t) ??
    /\b(II|I)\s*-?\s*lea\b/i.exec(t) ??
    /\bS([12])\b/.exec(t);
  if (!m) return null;
  const v = m[1].toUpperCase();
  return v === "II" || v === "2" ? 2 : 1;
}

export function detectFormat(url: string): SourceFormat {
  const u = url.toLowerCase();
  const path = u.split(/[?#]/)[0];
  if (path.endsWith(".xlsx") || path.endsWith(".xlsm")) return "xlsx";
  if (path.endsWith(".pdf")) return "pdf";
  if (u.includes("docs.google.com/spreadsheets")) return "gsheet";
  // SharePoint/OneDrive share links: ":x:" marks an Excel workbook.
  if (/sharepoint\.com\/:x:\//.test(u)) return "xlsx";
  return "link";
}

const EXAM_RE = /examen|sesiun|restan|evalu|programar/i;
const TIMETABLE_RE = /\borar/i;
const NOT_TIMETABLE_RE = /consulta|disponibil|s[aă]li\b|sali\b|grafic|tutori|decani|practic|procedur|structura anului/i;

export function classifyLink(link: PageLink, page: "timetable" | "exams"): DiscoveredSource | null {
  const format = detectFormat(link.url);
  const haystack = `${link.label} ${link.context} ${decodeURIComponent(link.url.split("/").pop() ?? "")}`;
  if (NOT_TIMETABLE_RE.test(`${link.label} ${decodeURIComponent(link.url.split("/").pop() ?? "")}`)) return null;

  let kind: SourceKind | null = null;
  if (page === "exams") kind = EXAM_RE.test(haystack) || format !== "link" ? "exams" : null;
  else if (TIMETABLE_RE.test(haystack) || format !== "link") kind = EXAM_RE.test(link.label) ? "exams" : "timetable";
  if (!kind) return null;
  // Plain web pages are only interesting when they are clearly documents.
  if (format === "link" && !/nextcloud|sharepoint|drive\.google|onedrive/i.test(link.url)) return null;

  return {
    url: link.url,
    label: link.label || decodeURIComponent(link.url.split("/").pop() ?? link.url),
    context: link.context,
    kind,
    format,
    academicYear: detectAcademicYear(haystack),
    semester: detectSemester(haystack),
  };
}

/** Keeps documents for the target semester; drops those clearly from another one. */
export function matchesSemester(source: DiscoveredSource, semester: SemesterRef): boolean {
  if (source.academicYear && source.academicYear !== semester.academicYear) return false;
  if (source.semester && source.semester !== semester.number) return false;
  return true;
}

/** Turns a share/view URL into one that returns the file itself. */
export function downloadUrl(source: Pick<DiscoveredSource, "url" | "format">): string {
  const { url } = source;
  if (/sharepoint\.com\//i.test(url)) {
    const u = new URL(url);
    u.searchParams.set("download", "1");
    return u.toString();
  }
  if (source.format === "gsheet") {
    // Published sheets render as HTML tables (keeping merged cells, unlike CSV).
    return url.replace(/\/pub\b(?!html)/, "/pubhtml");
  }
  return url;
}
