import * as cheerio from "cheerio";
import { classifyLink, detectAcademicYear, detectSemester, extractLinks, matchesSemester } from "../discover";
import { fetchText } from "../http";
import { headerColumns, type Box } from "../printed";
import { norm, parseStudyYear, squash } from "../text";
import type { DiscoveredSource, FacultyAdapter, NormalizedGroup, SpecRef } from "../types";

export const printedSlugs = {
  FAUT: "facultatea-de-arhitectura-si-urbanism",
  CT: "facultatea-de-constructii",
  CHIM: "facultatea-de-inginerie-chimica-biotehnologii-si-protectia-mediului",
  IEE: "facultatea-de-inginerie-electrica-si-energetica",
  MEC: "facultatea-de-mecanica",
};
const names: Record<string, string> = {
  MAI: "Mobilier și amenajări interioare", Urb: "Urbanism și amenajarea teritoriului",
  TMTN: "Tendințe, materiale și tehnologii noi în arhitectura de interior", RRP: "Restaurare și regenerare patrimonială",
  IC: "Inginerie chimică", "IC eng.": "Inginerie chimică în limba engleză", IM: "Ingineria mediului",
  IPA: "Ingineria produselor alimentare", ISAPM: "Ingineria substanţelor anorganice și protecția mediului",
  CISOPC: "Chimia și ingineria substanțelor organice, petrochimie și carbochimie",
  IAIM: "Informatică aplicată în ingineria mediului", CEPA: "Controlul şi expertiza produselor alimentare",
  PFCA: "Produse farmaceutice, cosmetice și alimentare - expertiză și calitate",
  IMMI: "Ingineria şi managementul mediului în industrie", DDIA: "Dezvoltare durabilă în ingineria apei, învățământ dual",
  EVC: "Economie verde și circulară", CCIA: "Construcţii civile, industriale şi agricole",
  CFDP: "Căi ferate, drumuri şi poduri", ACH: "Amenajări şi construcţii hidrotehnice",
  CSAAC: "Construcții pentru sisteme de alimentări cu apă și canalizări", IPT: "Infrastructuri pentru transporturi",
  OMSI: "Optimizarea și modernizarea sistemelor de instalații", CEBI: "Cadastru și evaluarea bunurilor imobile",
  RC: "Reabilitarea construcțiilor", ADB: "Advanced design of buildings", ADS: "Advanced Design of Steel and Composite Structures",
  DD: "Dezvoltare durabilă: auditul energetic și securitate la incendiu a clădirilor",
  OSH: "Optimizarea sistemelor hidrotehnice", OESISPM: "Optimizarea exploatării construcțiilor pentru sisteme de alimentare cu apă și canalizări",
  ISEE: "Ingineria sistemelor electroenergetice", ETI: "Energetică și tehnologii informatice",
  IEC: "Inginerie electrică și calculatoare", ET: "Electrotehnică", CSEE: "Conducerea sistemelor electroenergetice",
  SIIE: "Sisteme inteligente în inginerie electrică",
};

const groupHeader = /^(?:(?:semi)?gr(?:upa|oup|\.)?\s*(?:\d|[a-d]\b)|sgr\.?\s*\d|\d{3}$|[a-d]$|\d\s*\/\s*\d$|\d[A-C]$)/i;
const spec = (name: string, degree: SpecRef["degree"], language?: string): SpecRef =>
  ({ name: names[name] ?? name, degree, language, code: names[name] ? name : null });

export function printedColumns(slug: string, source: DiscoveredSource, pageText: string, header: Box[], clockRight: number) {
  const label = norm(source.label);
  const afterClock = header.filter((b) => b[0] >= clockRight - 0.5);
  const clockHeader = header.findLast((b) => Math.abs(b[2] - clockRight) < 0.6 && /ora|ore|hour/i.test(b[4]));
  const headings = afterClock.filter((b) => !clockHeader || b[1] >= clockHeader[1] - 0.5);
  const pageYear = parseStudyYear(pageText) ?? parseStudyYear(source.label);
  const make = (s: SpecRef, year: number | null, name = "", series = ""): NormalizedGroup | null =>
    year ? { spec: s, year, name, series } : null;

  if (slug === printedSlugs.FAUT) {
    return headerColumns(afterClock.filter((b) => parseStudyYear(b[4])), ([title]) => {
      const code = title.replace(/\bAn\s+[IV]+\b/i, "").replace(/^MA\s+/, "").trim();
      return make(spec(code, /^MA\s/.test(title) ? "master" : "bachelor", "RO"), parseStudyYear(title));
    });
  }
  if (slug === printedSlugs.CHIM) {
    return headerColumns(headings.filter((b) => !!names[squash(b[4])] || /^\d[A-C]$/.test(b[4])), (path) =>
      make(spec(path[0], /master/i.test(pageText.split("\n")[0]) ? "master" : "bachelor"), pageYear, path[1]));
  }
  if (slug === printedSlugs.IEE) {
    const code = /(?:Master|Licenta)\s*-\s*(\w+)/i.exec(source.context)?.[1];
    const year = parseStudyYear(source.context) ?? pageYear;
    return headerColumns(headings.filter((b) => /^(?:gr\.|grupa|\d\s*\/\s*\d)/i.test(squash(b[4]))), (path) => {
      const heading = norm(path.join(" "));
      let programme = code;
      if (year && year <= 2 && !/master/i.test(source.context))
        programme = label.includes("energetica") ? "Inginerie energetică" : "Inginerie electrică";
      // Each department publishes its own copy of the shared ISEE / ETI grid.
      if (/sistemelor electroenergetice/.test(heading) && code === "ETI" ||
          /tehnologii informatice/.test(heading) && code === "ISEE") return null;
      return programme ? make(spec(programme, /master/i.test(source.context) ? "master" : "bachelor", "RO"),
        year, path.find((s) => /^\d\s*\//.test(s))?.replaceAll(" ", "") ?? "") : null;
    });
  }
  if (slug === printedSlugs.CT) {
    const master = /master\s+(\w+)/i.exec(source.label);
    const yearHeadings = headings.filter((b) => parseStudyYear(b[4]));
    const groupHeadings = headings.filter((b) => groupHeader.test(squash(b[4])) || !!names[squash(b[4])]);
    const columns = [...yearHeadings, ...groupHeadings];
    if (!columns.length || (master && !groupHeadings.length && yearHeadings.length < 2)) {
      const title = headings.filter((b) => !/^(?:anul|master)\b/i.test(squash(b[4]))).sort((a,b) => (b[2]-b[0])-(a[2]-a[0]))[0];
      if (title) columns.push(title);
      else if (!columns.length) columns.push(...headings);
    }
    return headerColumns(columns, (path) => {
      const year = path.map(parseStudyYear).find(Boolean) ?? pageYear;
      const group = path.filter((s) => groupHeader.test(s)).join(" ");
      if (master) {
        const code = /ADVANCED DESIGN STEEL/i.test(pageText) ? "ADS" : master[1].toUpperCase();
        return make(spec(code, "master", ["ADB","ADS"].includes(code) ? "EN" : "RO"), year, group);
      }
      const code = path.find((s) => names[s]);
      const name = code ?? (label.includes("instalatii") ? "Instalații pentru construcții" :
        label.includes("cadastru") ? "Măsurători terestre şi cadastru" : "Inginerie civilă");
      const language = /\bice\b/.test(label) ? "EN" : /\bicg\b/.test(label) ? "DE" : "RO";
      return make(spec(name, "bachelor", language), year, group);
    });
  }

  // MEC prints a course key to the right of the timetable. Only the headings
  // above the activity columns end at or before the first hour row.
  const year = parseStudyYear(source.context) ?? pageYear;
  const master = /master/i.test(source.context);
  const isSeries = /^seria\s+[ab]\b/i.test(source.label);
  const allowed = afterClock.filter((b) => {
    const s = squash(b[4]);
    return groupHeader.test(s) || /^(?:s[aă]pt|disciplina\b|grupa\b|master$|profilul|specializarea|ing[ei.]|mecatronic|bioinginerie|[sș][tț]iin|robotic|SIM$|TCM$|year:)/i.test(s);
  });
  if (!allowed.length && clockHeader) {
    const first = afterClock.find((b) => Math.abs(b[0] - clockRight) < 6 && b[3] >= clockHeader[1]);
    if (first) allowed.push(first);
  }
  const columns = headerColumns(allowed, (path) => {
    const major = path.find((s) => /^(?:ing[ei.]|mecatronic|bioinginerie|[sș][tț]iin|robotic)/i.test(s));
    const english = /mechanical engineering|lb\. engleza/i.test(norm(source.label)) || /^Seria C/i.test(source.label);
    let name = english ? "Inginerie mecanică" : source.label;
    if (isSeries && major) name = major.replace(/^Ingeria/i, "Ingineria");
    if (label.includes("robotica dual") && path.some((s) => /grupa.*dual/i.test(s))) name = "Robotică, învățământ dual";
    if (label === "inginerie industriala" && path.includes("SIM")) name = "Ingineria materialelor";
    if (label === "ingineria transporturilor si traficului") name = "Ingineria transporturilor şi a traficului";
    if (label.includes("calitatii in inginerie medicala")) name = "Managementul calităţii în ingineria medicală";
    if (label === "inginerie industriala" && path.includes("TCM")) name = "Tehnologia construcţiilor de maşini";
    if (label.startsWith("ingineria relatiilor de munca")) name = "Ingineria relațiilor de muncă, sănătate și securitate în muncă";
    const group = path.filter((s) => groupHeader.test(s)).join(" ");
    return make(spec(name, master ? "master" : "bachelor", english ? "EN" : "RO"), year, group,
      isSeries ? source.label.split(" (")[0] : "");
  });
  // One MEC subgroup attends the same classes under two degree domains.
  return columns.flatMap((column) => norm(column.group.spec.name) === "ing autovehiculelor ing transporturilor"
    ? ["Ingineria autovehiculelor", "Ingineria transporturilor"].map((name) => ({
      ...column, group: { ...column.group, spec: { ...column.group.spec, name } },
    })) : [column]);
}

export const printedAdapters: FacultyAdapter[] = [
  { slug: printedSlugs.FAUT, classify(link, guess) {
    return /^orar semestr/i.test(link.label) && new URL(link.url).hostname === "nextcloud.upt.ro"
      ? { ...guess, format: "pdf" } : null;
  } },
  { slug: printedSlugs.MEC, timetableSources(html, url) {
    const $ = cheerio.load(html);
    const term = $("h1,h2,h3,h4,.elementor-heading-title").toArray().map((el) => squash($(el).text()))
      .find((s) => /orare.*20\d\d/i.test(s)) ?? "";
    return $("a[href]").toArray().flatMap((el) => {
      const a = $(el), tab = a.closest(".elementor-tab-content");
      const year = squash(tab.prev().text());
      if (!parseStudyYear(year)) return [];
      const cycle = tab.parents().map((_, p) => squash($(p).prev().text())).get().find((s) => /^Ciclul (licen|master)/i.test(s));
      if (!cycle) return [];
      const context = [cycle, year, term].join(" · ");
      const label = squash(a.text());
      if (!label) return [];
      const guess = classifyLink({ url: new URL(a.attr("href")!, url).href, label, context }, "timetable");
      return guess?.format === "pdf" ? [guess] : [];
    });
  } },
  { slug: printedSlugs.IEE, classify: (_link, guess) => guess.format === "pdf" && /^(Licenta|Master) -/i.test(guess.context) ? guess : null },
  { slug: printedSlugs.CT },
  { slug: printedSlugs.CHIM, async timetableSources(html, url, semester) {
    const $ = cheerio.load(html);
    const post = $('link[rel="alternate"][type="application/json"]').attr("href")?.match(/\/posts\/(\d+)$/)?.[1];
    if (!post) return []; // The category index links to a post for each semester.
    const files = extractLinks(html, url).flatMap((link) => {
      const s = classifyLink(link, "timetable");
      return s?.format === "pdf" && /orar/i.test(s.label) && matchesSemester(s, semester) ? [s] : [];
    });
    const bounded = files.find((f) => /s[aă]pt[_ .]+8[-–]14/i.test(f.label));
    if (!bounded) return files;
    // WordPress keeps the earlier timetable attached to the same semester post
    // after the faculty changes its download button to the weeks 8–14 edition.
    const base = files.find((f) => !/s[aă]pt/i.test(f.label));
    if (base) { base.label += " (sapt. 1-7)"; return files; }
    const endpoint = new URL("/wp-json/wp/v2/media", url);
    endpoint.search = new URLSearchParams({ parent: post, per_page: "100", _fields: "source_url,date" }).toString();
    const media: Array<{ source_url: string; date: string }> = JSON.parse((await fetchText(endpoint.href)).text);
    const published = media.find((m) => m.source_url === bounded.url);
    const earlier = media.filter((m) => published && m.date < published.date &&
      /\/ORAR_sem[^/]*\.pdf$/i.test(m.source_url) && !/s[aă]pt/i.test(m.source_url) &&
      detectAcademicYear(m.source_url) === semester.academicYear && detectSemester(m.source_url) === semester.number)
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    if (earlier) files.push({ ...bounded, url: earlier.source_url, label: "Orar semestrul " + semester.number + " (sapt. 1-7)" });
    return files;
  } },
];

/** Date stamps inside a document are checked independently of the faculty's link. */
export function pageTerm(text: string) {
  const lines = text.split("\n");
  const yearLine = lines.findIndex((line) => /20\d\d\s*[-–/]\s*20\d\d/.test(line));
  const heading = yearLine < 0 ? lines.slice(0, 4) : lines.slice(Math.max(0, yearLine - 3), yearLine + 3);
  const termLine = heading.find((line) => /\bsem(?:\b|estr)/i.test(line));
  return {
    academicYear: yearLine < 0 ? null : detectAcademicYear(lines[yearLine]),
    semester: termLine ? detectSemester(termLine) : null,
  };
}
