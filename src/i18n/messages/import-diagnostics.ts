import type { Locale } from "../config";

// The importer persists its diagnostics in English. Render the recorded numbers,
// URLs and publication titles in the reader's language, including older runs.
const romanian: [RegExp, string][] = [
  [/Target: semester (\d+) of ([\d-]+)( \(dry run\))?\./g, "Semestrul $1 din $2$3."],
  [/\(dry run\)/g, "(rulare de probă)"],
  [/Finished: (\d+) imported, (\d+) not machine-readable, (\d+) failed; (\d+) activities, (\d+) exams\./g,
    "Import încheiat. Documente importate: $1. Documente care necesită citire manuală: $2. Importuri eșuate: $3. Activități: $4. Examene: $5."],
  [/: scanned (https?:\/\/\S+)/g, ": pagină verificată $1"],
  [/(\d+) timetable document\(s\) for this semester/g, "documente cu orare pentru acest semestru: $1"],
  [/(\d+) exams document\(s\) for this semester/g, "documente cu examene pentru acest semestru: $1"],
  [/(\d+) (?:sheet|table)\(s\), (\d+) activities/g, "tabele: $1, activități: $2"],
  [/, (\d+) sheet\(s\) skipped/g, ", foi omise: $1"],
  [/(\d+) dated assessments/g, "evaluări cu dată publicată: $1"],
  [/(\d+) dated activities/g, "activități cu dată publicată: $1"],
  [/(\d+) exam(?: booking)?\(s\)/g, "programări de examene: $1"],
  [/Page (\d+) is labelled ([\d-]*) semester ([\d?]+)\. Check the faculty publication\./g,
    "Pagina $1 este marcată pentru anul $2, semestrul $3. Verifică documentul facultății."],
  [/The ([\d-]+) repeat sitting for (.+?) precedes the published first sitting for this term\./g,
    "Restanța din $1 la $2 precedă prima dată de examen publicată pentru acest semestru."],
  [/Reading faculties and study programmes from upt\.ro…/g, "Se citesc facultățile și programele de studii de pe upt.ro…"],
  [/Catalog updated: (\d+) faculties, (\d+) programmes/g, "Catalog actualizat. Facultăți: $1. Programe de studii: $2"],
  [/Catalog: (\d+) faculties, (\d+) programmes/g, "Catalog. Facultăți: $1. Programe de studii: $2"],
  [/Catalog: read bachelor programmes from /g, "S-au citit programele de licență de la "],
  [/Catalog: read master programmes from /g, "S-au citit programele de master de la "],
  [/no published timetable found on the faculty page for the selected semester/g, "pe pagina facultății nu apare un orar pentru semestrul ales"],
  [/No current semester is configured/g, "Semestrul curent nu a fost configurat"],
  [/No faculties in the database yet — run the catalog scrape first/g, "Baza de date nu conține facultăți. Importă mai întâi catalogul"],
  [/No timetable grid recognised in this document|no timetable grid recognised/g, "Nu s-a identificat niciun orar în document"],
  [/Page (\d+) contains an unrecognised timetable/g, "Pagina $1 conține un orar care necesită citire manuală"],
  [/Sheet "([^"]+)" has no recognised activities/g, "Foaia „$1” nu conține activități recunoscute"],
  [/Keeping (\d+) previously imported items/g, "Se păstrează $1 înregistrări importate anterior"],
  [/PDF document: linked for students, not machine-readable/g, "Document PDF disponibil pentru studenți. Necesită citire manuală"],
  [/External document: linked for students, not machine-readable/g, "Document extern disponibil pentru studenți. Necesită citire manuală"],
  [/No exam parser for this faculty's format yet/g, "Formatul examenelor acestei facultăți necesită citire manuală"],
  [/could not read the timetable page/g, "nu s-a putut citi pagina cu orare"],
  [/could not read the exams page/g, "nu s-a putut citi pagina cu examene"],
  [/" failed — /g, '" — import eșuat: '],
];

export function importDiagnostic(message: string | null, locale: Locale): string {
  if (!message || locale === "en") return message ?? "";
  return romanian.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), message);
}
