import { plural } from "../config";

/** Texts for the exams page, exam cards and Poli's exam tips (src/lib/examTips.ts). */
const en = {
  page: {
    title: "Exams",
    intro: (faculty: string | null) =>
      `Exam dates for your programme and year at ${faculty ?? "your faculty"}.`,
    noneBooked:
      "No exam is booked for your specialization and year yet. Faculties fill in the session calendar as the exam period approaches. Search below to see what has been published so far.",
    noneImported:
      "Your faculty’s exam dates aren’t available here yet. Check the faculty announcements for the latest schedule.",
    searchHeading: (faculty: string | null) => `Search all exams${faculty ? ` at ${faculty}` : ""}`,
    searchPlaceholder: "Course, teacher, room…",
    searchLabel: "Search exams",
    noMatch: (q: string) => `Nothing matches “${q}”.`,
    columns: { date: "Date", time: "Time", course: "Course", where: "Where", audience: "For" },
    source: "Source:",
    lastImported: (date: string) => `last imported ${date}`,
  },
  card: {
    room: (room: string) => `Room ${room}`,
    roomUnknown: "Room not published yet",
    /** One of the sittings (prezentări) of the same exam in a session. */
    sitting: (n: number) => `Sitting ${n} of the exam`,
    approximate: "(approximate)",
    openMap: "Open map ↗",
  },
  countdown: {
    now: "now",
    inMinutes: (m: number) => `in ${m} min`,
    inHours: (h: number, m: number) => `in ${h} h${m ? ` ${m} min` : ""}`,
    tomorrow: "tomorrow",
    inDays: (n: number) => `in ${n} days`,
  },
  where: {
    roomIn: (room: string, building: string) => `room ${room} (${building})`,
    room: (room: string) => `room ${room}`,
    unknown: "the room on the exam list",
  },
  headline: {
    now: (course: string, where: string) => `${course} is starting now in ${where}. Good luck! 🍀`,
    today: (course: string, time: string, where: string) => `${course} exam today at ${time}, ${where}. You've got this! 💪`,
    tomorrow: (course: string, time: string, where: string) => `${course} exam tomorrow at ${time}, ${where}.`,
    soon: (course: string, days: number, where: string) => `${course} exam in ${days} days, ${where}.`,
    week: (course: string, days: number) => `${course} exam next week: ${days} days to go.`,
    later: (course: string, days: number) => `${course} exam in ${days} days. Plenty of time to plan.`,
  },
  tips: {
    now: "Breathe, read every question once before you start, and do the easy ones first.",
    leave: (minutes: number, time: string, where: string) =>
      `Leave about ${minutes} minutes before ${time} to reach ${where} with time to spare.`,
    beThere: (where: string, by: string) => `Be at ${where} by ${by}, 15 minutes before it starts.`,
    pack: "Pack your student ID, pens and anything the teacher allowed (calculator, formula sheet).",
    eat: "Eat something and bring water. A calm brain works better. 🥤",
    review: "Do one light review of your summary notes. No new chapters tonight.",
    route: (where: string) => `Check how to get to ${where} and set an alarm with a buffer.`,
    sleep: "Sleep at least 7 hours; it helps memory more than a late-night cram. 😴",
    pastExam: "Solve a past exam or a mock test under time pressure.",
    ask: "Write down what you still don't get and ask a colleague or the teacher.",
    blocks: "Study in 25-minute blocks with 5-minute breaks to stay fresh.",
    split: "Split the material into one chunk per day until the exam.",
    summary: "Make a one-page summary of formulas and key ideas.",
    group: "Join or start a study group: explaining something is the best test.",
    plan: "Put the exam in your calendar and plan when to start reviewing.",
    steady: "A little each week beats everything in the last three days. 📚",
  },
  /** Gentle tips for days without exams coming up. */
  everyday: [
    "Take a 5-minute break every 25 minutes of study. Your focus will thank you. ⏱️",
    "Drink some water and stretch. Long hours at the desk add up. 💧",
    "Review today's lecture notes for 10 minutes tonight. It saves hours before exams.",
    "Plan tomorrow in two minutes: classes, rooms, and one thing you want to get done. ✅",
    "Get some fresh air between classes. A short walk resets your head. 🌳",
    "Ask questions in the seminar. Someone else is probably wondering the same thing. 🙋",
  ],
};

/** "3 zile", "o zi", "20 de zile". */
const zile = (n: number) => plural("ro", n, { one: "o zi", few: `${n} zile`, other: `${n} de zile` });
const minute = (n: number) => plural("ro", n, { one: "un minut", few: `${n} minute`, other: `${n} de minute` });

const ro: typeof en = {
  page: {
    title: "Examene",
    intro: (faculty: string | null) =>
      `Examenele tale publicate de ${faculty ?? "facultatea ta"} pentru specializarea și anul tău, cu câteva sfaturi de la Poli.`,
    noneBooked:
      "Încă nu e programat niciun examen pentru specializarea și anul tău. Facultățile completează calendarul sesiunii pe măsură ce se apropie examenele. Caută mai jos ca să vezi ce s-a publicat până acum.",
    noneImported:
      "Datele examenelor nu sunt încă disponibile aici. Verifică anunțurile facultății pentru programul actualizat.",
    searchHeading: (faculty: string | null) => `Caută în toate examenele${faculty ? ` de la ${faculty}` : ""}`,
    searchPlaceholder: "Materie, cadru didactic, sală…",
    searchLabel: "Caută examene",
    noMatch: (q: string) => `Nimic nu se potrivește cu „${q}”.`,
    columns: { date: "Data", time: "Ora", course: "Materia", where: "Unde", audience: "Pentru" },
    source: "Sursa:",
    lastImported: (date: string) => `ultimul import: ${date}`,
  },
  card: {
    room: (room: string) => `Sala ${room}`,
    roomUnknown: "Sala nu a fost publicată încă",
    sitting: (n: number) => `Prezentarea ${n}`,
    approximate: "(aproximativ)",
    openMap: "Deschide harta ↗",
  },
  countdown: {
    now: "acum",
    inMinutes: (m: number) => `în ${m} min`,
    inHours: (h: number, m: number) => `în ${h} h${m ? ` ${m} min` : ""}`,
    tomorrow: "mâine",
    inDays: (n: number) => `în ${zile(n)}`,
  },
  where: {
    roomIn: (room: string, building: string) => `sala ${room} (${building})`,
    room: (room: string) => `sala ${room}`,
    unknown: "sala din lista de examene",
  },
  headline: {
    now: (course: string, where: string) => `${course} începe acum, în ${where}. Baftă! 🍀`,
    today: (course: string, time: string, where: string) => `Examen la ${course} azi la ${time}, ${where}. Te descurci! 💪`,
    tomorrow: (course: string, time: string, where: string) => `Examen la ${course} mâine la ${time}, ${where}.`,
    soon: (course: string, days: number, where: string) => `Examen la ${course} în ${zile(days)}, ${where}.`,
    week: (course: string, days: number) => `Examen la ${course} săptămâna viitoare: mai ai ${zile(days)}.`,
    later: (course: string, days: number) => `Examen la ${course} în ${zile(days)}. Ai timp să-ți faci un plan.`,
  },
  tips: {
    now: "Respiră, citește toate subiectele o dată înainte să începi și rezolvă-le întâi pe cele ușoare.",
    leave: (minutes: number, time: string, where: string) =>
      `Pleacă cu vreo ${minute(minutes)} înainte de ${time}, ca să ajungi la ${where} din timp.`,
    beThere: (where: string, by: string) => `Fii la ${where} până la ${by}, cu 15 minute înainte de început.`,
    pack: "Ia-ți carnetul de student, pixuri și tot ce a permis profesorul (calculator, foaie cu formule).",
    eat: "Mănâncă ceva și ia apă cu tine. Un creier liniștit lucrează mai bine. 🥤",
    review: "Fă o recapitulare ușoară după rezumatele tale. Fără capitole noi în seara asta.",
    route: (where: string) => `Verifică cum ajungi la ${where} și pune-ți alarma cu o marjă de timp.`,
    sleep: "Dormi cel puțin 7 ore: ajută memoria mai mult decât tocitul până noaptea târziu. 😴",
    pastExam: "Rezolvă un subiect din anii trecuți sau un test de probă, cu cronometrul pornit.",
    ask: "Notează ce încă nu înțelegi și întreabă un coleg sau profesorul.",
    blocks: "Învață în reprize de 25 de minute, cu pauze de 5 minute, ca să rămâi odihnit.",
    split: "Împarte materia în câte o bucată pe zi până la examen.",
    summary: "Fă-ți un rezumat de o pagină cu formulele și ideile principale.",
    group: "Intră într-un grup de studiu sau fă-ți unul: când explici altcuiva, vezi cel mai bine ce știi.",
    plan: "Trece examenul în calendar și stabilește când începi recapitularea.",
    steady: "Câte puțin în fiecare săptămână e mai bine decât totul în ultimele trei zile. 📚",
  },
  everyday: [
    "Fă o pauză de 5 minute la fiecare 25 de minute de învățat. Concentrarea îți va mulțumi. ⏱️",
    "Bea puțină apă și întinde-te. Orele lungi la birou se adună. 💧",
    "Recitește diseară, 10 minute, notițele de la cursurile de azi. Te scutește de ore întregi înainte de examene.",
    "Planifică-ți ziua de mâine în două minute: ore, săli și un lucru pe care vrei să-l rezolvi. ✅",
    "Ieși puțin la aer între ore. O plimbare scurtă îți limpezește mintea. 🌳",
    "Pune întrebări la seminar. Probabil și altcineva se întreabă același lucru. 🙋",
  ],
};

export const exams = { en, ro };
