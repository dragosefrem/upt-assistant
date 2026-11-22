/**
 * The freshman guide: first-week checklist, how to read a timetable, and the glossary.
 * Glossary entries keep the Romanian word as the headword in both languages, because
 * that is the word printed in the timetable.
 */

export interface GlossaryEntry {
  id: string;
  /** The word as printed in timetables and said on campus. */
  term: string;
  /** One line: what it is. */
  short: string;
  /** A few sentences: what it means for the student. */
  body: string;
  /** Other spellings and abbreviations that should find this entry. */
  also: string[];
}

export interface GuideStep {
  id: string;
  title: string;
  body: string;
  /** In-app page that does it, when there is one. */
  href?: string;
  action: string;
  /** A question to send to Poli instead of a page. */
  ask?: string;
}

const en = {
  title: "Guide",
  heading: "Your first weeks at UPT",
  nav: { firstWeek: "First week", semester: "This semester" },
  firstWeek: {
    title: "First-week checklist",
    intro: "Progress is saved on this device.",
    done: (n: number, total: number) => `${n} of ${total} done`,
    allDone: "Checklist complete",
  },
  steps: [
    {
      id: "group",
      title: "Check your group and semigroup",
      body: "Match the group and semigroup in Settings to the ones your faculty assigned you.",
      href: "/settings",
      action: "Open settings",
    },
    {
      id: "choices",
      title: "Pick your lab slots and electives",
      body: "If a lab has several slots, choose the one you attend. Only the electives you select appear on your timetable.",
      href: "/timetable-settings#courses",
      action: "Choose courses",
    },
    {
      id: "labs",
      title: "Find out which labs run this week",
      body: "Some labs meet only in odd or even teaching weeks.",
      ask: "Do I have lab this week?",
      action: "Ask Poli about my labs",
    },
    {
      id: "rooms",
      title: "Find your rooms before the first class",
      body: "Select a room in Campus for directions from the building entrance.",
      href: "/campus",
      action: "Open Campus",
    },
    {
      id: "rules",
      title: "Read each course's rules",
      body: "Check the fișa disciplinei for attendance and grading rules. If you miss a lab, ask the instructor before joining another semigroup to make it up.",
      ask: "I missed a lab. Which other groups have it this week?",
      action: "Ask about a make-up lab",
    },
    {
      id: "phone",
      title: "Put the timetable on your phone",
      body: "Subscribe to timetable updates or send yourself a calendar file.",
      href: "/timetable-settings#export",
      action: "Export the calendar",
    },
  ] as GuideStep[],
  semester: {
    title: "This semester at a glance",
    none: "The academic calendar is not set up yet.",
    name: (n: number, year: string) => `Semester ${n}, ${year}`,
    now: "Right now",
    teachingWeek: (n: number, total: number, parity: string) => `Teaching week ${n} of ${total} (${parity})`,
    odd: "odd",
    even: "even",
    holidayNow: (resumes: string) => `Holiday — classes resume on ${resumes}`,
    sessionNow: "Exam session",
    beforeStart: (starts: string) => `Classes start on ${starts}`,
    over: "This semester is over.",
    teaching: "Classes",
    teachingRange: (from: string, to: string, weeks: number) => `${from} – ${to} · ${weeks} teaching weeks`,
    holiday: "Holiday",
    holidayRange: (from: string, to: string) => `${from} – ${to}`,
    session: "Exam session",
    sessionRange: (from: string, to: string) => `${from} – ${to}`,
    examsPublished: (n: number) => `${n} of your exams ${n === 1 ? "is" : "are"} already published.`,
    examsNotPublished: "No upcoming exam dates have been published for you.",
    seeExams: "See exams",
    weeksLeft: (n: number) => `${n} teaching ${n === 1 ? "week" : "weeks"} left`,
  },
  glossary: {
    title: "UPT glossary",
    yourPlace: (programme: string, year: number, group: string) => `You are in ${programme}, year ${year}, ${group}.`,
    noGroup: "Choose your group in Settings",
    search: "Search a word or abbreviation…",
    searchLabel: "Search the glossary",
    none: (q: string) => `No matching terms for “${q}”.`,
  },
  buildings: {
    title: "Your buildings",
    open: "Open Campus",
    none: "Once you have a timetable, your buildings show up here.",
    map: "Map",
    walkthrough: "Show me the way",
    approximate: "position approximate",
  },
  entries: [
    { id: "activitati", term: "C / S / L / P", short: "C = curs (lecture), S = seminar, L = laborator (lab), P = proiect (project).", body: "Look under your series for C, your group for S and your semigroup for L or P.", also: ["c", "curs", "lecture", "s", "seminar", "sem.", "l", "laborator", "lab", "lucrare", "lucrări practice", "p", "proiect", "project"] },
    { id: "serie", term: "Serie", short: "Several groups that attend lectures together.", body: "Find your series above the group columns on the faculty timetable. Some lectures are shared by the whole year.", also: ["seria", "series"] },
    { id: "grupa", term: "Grupă", short: "In a label like 2.1, the number before the dot identifies group 2.", body: "Semigroups 2.1 and 2.2 both follow its seminar column.", also: ["grupa", "group", "gr."] },
    { id: "semigrupa", term: "Semigrupă", short: "Half of a group, used for labs and projects.", body: "Check the lab time listed for your full code, such as 2.1.", also: ["semigrupa", "subgrupă", "subgrupa", "semigroup", "subgroup", "sgr."] },
    { id: "paritate", term: "Săptămână pară / impară", short: "S.p. marks even teaching weeks and s.i. marks odd ones. Skip holidays when counting from the first week of classes.", body: "A range such as 1–7 or 8–14 limits a class to those teaching weeks.", also: ["para", "impara", "odd", "even", "odd week", "even week", "săptămână impară", "săptămâni pare", "săptămâni impare", "paritate", "s.i.", "s.p.", "sapt. para", "sapt. impara", "1-7", "8-14", "1–7", "8–14", "săpt. 1–7 / 8–14", "saptamanile 1-7", "saptamanile 8-14", "modul"] },
    { id: "sala", term: "Coduri de sală", short: "At Electro, B413 means wing B, fourth floor.", body: "D1 is a lecture hall. ASPC and SPM identify separate buildings.", also: ["sala", "room", "room codes", "corp", "cod sala", "amfiteatru", "amf.", "amphitheatre", "aula", "B413", "D1", "ASPC", "SPM"] },
    { id: "sesiune", term: "Sesiune", short: "The exam period after classes end.", body: "Check the Exams page for dates and rooms published by your faculty.", also: ["sesiunea", "session", "exam session", "sesiune de examene"] },
    { id: "restanta", term: "Restanță", short: "An exam you still have to pass.", body: "If you miss or fail an exam, ask your faculty secretariat about the next resit date and requirements.", also: ["restanta", "restanțe", "resit", "retake", "reexaminare"] },
    { id: "evaluare", term: "Examen (E) / Evaluare distribuită (D)", short: "E means the main assessment is an exam during the exam session.", body: "For D, tests and assignments during the semester determine your grade. The course syllabus gives the grading breakdown.", also: ["examen", "exam", "evaluare distribuita", "ed", "colocviu", "verificare"] },
    { id: "credite", term: "Credite (ECTS)", short: "You earn a course’s credits when you pass it.", body: "A full semester totals 30 credits and an academic year totals 60.", also: ["credit", "credits", "ects", "puncte credit"] },
    { id: "fisa", term: "Fișa disciplinei", short: "The course syllabus lists compulsory activities and explains how your grade is calculated.", body: "Your instructor presents it at the first lecture.", also: ["fisa disciplinei", "syllabus", "programa"] },
    { id: "optional", term: "Disciplină opțională / facultativă", short: "An opțională is chosen from a set and counts towards your degree. A facultativă is an extra course.", body: "Select the courses you take in Settings to see them on your timetable.", also: ["optional", "optionala", "facultativ", "facultativa", "elective"] },
    { id: "titluri", term: "Prof., conf., ș.l., as.", short: "Prof. means professor and conf. (conferențiar) means associate professor.", body: "Ș.l. (șef de lucrări) is a lecturer and as. (asistent) is a teaching assistant.", also: ["prof", "conf", "sl", "s.l.", "ș.l.", "as", "asist", "conferentiar", "sef lucrari", "asistent"] },
    { id: "secretariat", term: "Secretariat / Decanat", short: "Ask the secretariat for proof of enrolment, transcripts or help with registration.", body: "The decanat is the dean’s office.", also: ["secretariat", "decanat", "decan", "dean", "office", "adeverinta"] },
    { id: "cv", term: "Campus Virtual (CV)", short: "Sign in to cv.upt.ro with your university account.", body: "Your instructors post course materials, assignments and announcements there.", also: ["campus virtual", "cv", "cv.upt.ro", "moodle", "elearning"] },
    { id: "id-ifr", term: "ID / IFR", short: "ID means învățământ la distanță (distance learning). IFR means învățământ cu frecvență redusă (part-time study).", body: "Check the individual dates for on-campus classes, which often meet at weekends.", also: ["id", "ifr", "distanta", "frecventa redusa", "distance learning", "part-time"] },
  ] as GlossaryEntry[],
};

const ro: typeof en = {
  title: "Ghid",
  heading: "Primele tale săptămâni la UPT",
  nav: { firstWeek: "Prima săptămână", semester: "Semestrul acesta" },
  firstWeek: {
    title: "De făcut în prima săptămână",
    intro: "Progresul se salvează pe acest dispozitiv.",
    done: (n: number, total: number) => `${n} din ${total} rezolvate`,
    allDone: "Ai terminat lista",
  },
  steps: [
    {
      id: "group",
      title: "Verifică-ți grupa și semigrupa",
      body: "Verifică în Setări dacă ai ales grupa și semigrupa în care te-a repartizat facultatea.",
      href: "/settings",
      action: "Deschide setările",
    },
    {
      id: "choices",
      title: "Alege-ți intervalele de laborator și opționalele",
      body: "Dacă laboratorul are mai multe intervale, alege-l pe cel la care mergi. În orar apar doar opționalele selectate.",
      href: "/timetable-settings#courses",
      action: "Alege disciplinele",
    },
    {
      id: "labs",
      title: "Află ce laboratoare ai săptămâna aceasta",
      body: "Unele laboratoare se țin doar în săptămânile pare sau doar în cele impare.",
      ask: "Am laborator săptămâna aceasta?",
      action: "Întreabă-l pe Poli despre laboratoare",
    },
    {
      id: "rooms",
      title: "Găsește-ți sălile înainte de prima oră",
      body: "Alege o sală pe pagina Campus ca să vezi traseul de la intrarea în clădire.",
      href: "/campus",
      action: "Deschide Campus",
    },
    {
      id: "rules",
      title: "Citește regulile fiecărei discipline",
      body: "Verifică în fișa disciplinei regulile de prezență și de notare. Dacă ai lipsit de la un laborator, cere acordul cadrului didactic ca să-l recuperezi cu altă semigrupă.",
      ask: "Am lipsit de la un laborator. Ce alte grupe îl au săptămâna aceasta?",
      action: "Întreabă despre recuperare",
    },
    {
      id: "phone",
      title: "Pune-ți orarul pe telefon",
      body: "Abonează-te la calendar ca să primești actualizări sau trimite-ți orarul pe e-mail.",
      href: "/timetable-settings#export",
      action: "Exportă calendarul",
    },
  ],
  semester: {
    title: "Semestrul pe scurt",
    none: "Calendarul academic nu este configurat încă.",
    name: (n: number, year: string) => `Semestrul ${n}, ${year}`,
    now: "Acum",
    teachingWeek: (n: number, total: number, parity: string) => `Săptămâna ${n} din ${total} (${parity})`,
    odd: "impară",
    even: "pară",
    holidayNow: (resumes: string) => `Vacanță — orele se reiau pe ${resumes}`,
    sessionNow: "Sesiune de examene",
    beforeStart: (starts: string) => `Orele încep pe ${starts}`,
    over: "Semestrul acesta s-a încheiat.",
    teaching: "Ore",
    teachingRange: (from: string, to: string, weeks: number) => `${from} – ${to} · ${weeks} săptămâni de școală`,
    holiday: "Vacanță",
    holidayRange: (from: string, to: string) => `${from} – ${to}`,
    session: "Sesiune",
    sessionRange: (from: string, to: string) => `${from} – ${to}`,
    examsPublished: (n: number) => (n === 1 ? "Un examen al tău este deja publicat." : `${n}${n >= 20 ? " de" : ""} examene ale tale sunt deja publicate.`),
    examsNotPublished: "Nu sunt publicate date pentru următoarele tale examene.",
    seeExams: "Vezi examenele",
    weeksLeft: (n: number) => (n === 1 ? "a mai rămas o săptămână de școală" : `au mai rămas ${n} săptămâni de școală`),
  },
  glossary: {
    title: "Glosar UPT",
    yourPlace: (programme: string, year: number, group: string) => `Ești la ${programme}, anul ${year}, ${group}.`,
    noGroup: "Alege-ți grupa în Setări",
    search: "Caută un cuvânt sau o prescurtare…",
    searchLabel: "Caută în glosar",
    none: (q: string) => `Niciun termen găsit pentru „${q}”.`,
  },
  buildings: {
    title: "Clădirile tale",
    open: "Deschide Campus",
    none: "După ce ai un orar, clădirile tale apar aici.",
    map: "Hartă",
    walkthrough: "Arată-mi drumul",
    approximate: "poziție aproximativă",
  },
  entries: [
    { id: "activitati", term: "C / S / L / P", short: "C = curs, S = seminar, L = laborator, P = proiect.", body: "Pentru C urmărește seria, pentru S grupa, iar pentru L și P semigrupa.", also: ["c", "curs", "lecture", "s", "seminar", "sem.", "l", "laborator", "lab", "lucrare", "lucrări practice", "p", "proiect", "project"] },
    { id: "serie", term: "Serie", short: "Mai multe grupe care merg împreună la cursuri.", body: "În orarul facultății, seria apare deasupra coloanelor grupelor. Unele cursuri se țin cu tot anul.", also: ["seria", "series"] },
    { id: "grupa", term: "Grupă", short: "Într-un cod ca 2.1, numărul dinaintea punctului indică grupa 2.", body: "Semigrupele 2.1 și 2.2 au același orar de seminare.", also: ["grupa", "group", "gr."] },
    { id: "semigrupa", term: "Semigrupă", short: "Jumătate de grupă pentru laboratoare și proiecte.", body: "Verifică ora de laborator din dreptul codului tău complet, de exemplu 2.1.", also: ["semigrupa", "subgrupă", "subgrupa", "semigroup", "subgroup", "sgr."] },
    { id: "paritate", term: "Săptămână pară / impară", short: "S.p. înseamnă săptămâni pare, iar s.i., săptămâni impare. Numerotarea începe în prima săptămână de cursuri și sare peste vacanțe.", body: "Un interval precum 1–7 sau 8–14 arată săptămânile de curs în care se ține ora.", also: ["para", "impara", "odd", "even", "odd week", "even week", "săptămână impară", "săptămâni pare", "săptămâni impare", "paritate", "s.i.", "s.p.", "sapt. para", "sapt. impara", "1-7", "8-14", "1–7", "8–14", "săpt. 1–7 / 8–14", "saptamanile 1-7", "saptamanile 8-14", "modul"] },
    { id: "sala", term: "Coduri de sală", short: "La Electro, B413 înseamnă corpul B, etajul 4.", body: "D1 este un amfiteatru. ASPC și SPM sunt coduri de clădiri.", also: ["sala", "room", "room codes", "corp", "cod sala", "amfiteatru", "amf.", "amphitheatre", "aula", "B413", "D1", "ASPC", "SPM"] },
    { id: "sesiune", term: "Sesiune", short: "Perioada de examene de după încheierea cursurilor.", body: "Pe pagina Examene găsești datele și sălile publicate de facultate.", also: ["sesiunea", "session", "exam session", "sesiune de examene"] },
    { id: "restanta", term: "Restanță", short: "Un examen pe care încă trebuie să-l promovezi.", body: "Dacă ai lipsit sau ai picat, întreabă la secretariat când poți da din nou examenul și în ce condiții.", also: ["restanta", "restanțe", "resit", "retake", "reexaminare"] },
    { id: "evaluare", term: "Examen (E) / Evaluare distribuită (D)", short: "La E, nota depinde în principal de examenul din sesiune.", body: "La D, nota se formează din teste și teme pe parcursul semestrului. Ponderea lor apare în fișa disciplinei.", also: ["examen", "exam", "evaluare distribuita", "ed", "colocviu", "verificare"] },
    { id: "credite", term: "Credite (ECTS)", short: "Primești creditele unei discipline după ce o promovezi.", body: "Un semestru însumează 30 de credite, iar un an universitar 60.", also: ["credit", "credits", "ects", "puncte credit"] },
    { id: "fisa", term: "Fișa disciplinei", short: "În fișa disciplinei găsești activitățile obligatorii și modul de calcul al notei.", body: "Cadrul didactic o prezintă la primul curs.", also: ["fisa disciplinei", "syllabus", "programa"] },
    { id: "optional", term: "Disciplină opțională / facultativă", short: "O opțională se alege dintr-un pachet și contează la diplomă. O facultativă se urmează în plus.", body: "Selectează în Setări disciplinele pe care le urmezi ca să apară în orar.", also: ["optional", "optionala", "facultativ", "facultativa", "elective"] },
    { id: "titluri", term: "Prof., conf., ș.l., as.", short: "Prof. înseamnă profesor, iar conf. înseamnă conferențiar.", body: "Ș.l. înseamnă șef de lucrări, iar as. înseamnă asistent universitar.", also: ["prof", "conf", "sl", "s.l.", "ș.l.", "as", "asist", "conferentiar", "sef lucrari", "asistent"] },
    { id: "secretariat", term: "Secretariat / Decanat", short: "La secretariat ceri adeverințe, situația școlară și informații despre înmatriculare.", body: "Decanatul este biroul decanului.", also: ["secretariat", "decanat", "decan", "dean", "office", "adeverinta"] },
    { id: "cv", term: "Campus Virtual (CV)", short: "Intră pe cv.upt.ro cu contul de la universitate.", body: "Acolo găsești materialele de curs, temele și anunțurile cadrelor didactice.", also: ["campus virtual", "cv", "cv.upt.ro", "moodle", "elearning"] },
    { id: "id-ifr", term: "ID / IFR", short: "ID înseamnă învățământ la distanță, iar IFR înseamnă învățământ cu frecvență redusă.", body: "Verifică în calendar datele orelor din campus. Acestea se țin adesea în weekend.", also: ["id", "ifr", "distanta", "frecventa redusa", "distance learning", "part-time"] },
  ],
};

export const guide = { en, ro };
