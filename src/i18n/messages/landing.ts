/** Texts for the public welcome page. */
const en = {
  notFound: { title: "Page not found", line: "Poli couldn’t find this page. Let’s get you back on track." },
  title: "Your timetable, decoded",
  nav: { signIn: "Sign in", start: "Get started", openApp: "Open my calendar" },
  hero: {
    badge: "For students of Politehnica Timișoara",
    headline: "Your UPT timetable, finally in plain sight.",
    sub: "UPT Orar turns the faculty's big timetable grid into your own calendar: only your group's classes, in the weeks they really happen, with the way to every room and an assistant that answers in seconds.",
    cta: "Create a free account",
    secondary: "I already have an account",
    note: "Takes a minute: pick your faculty, year and group.",
  },
  preview: {
    week: "Week 9 · odd",
    days: ["Mon", "Tue", "Wed", "Thu", "Fri"],
    question: "Do I have lab this week?",
    answer: "Yes — PC lab on Thursday at 10:00 in B418a. The physics lab is next week: it runs in even weeks.",
    chip: "Walkthrough to B418a",
    lecture: "Lecture",
    lab: "Lab",
    seminar: "Seminar",
  },
  stats: { groups: "groups", classes: "classes imported", faculties: "faculties", languages: "languages: RO and EN" },
  featuresTitle: "Everything a first-year keeps asking, answered",
  features: [
    { icon: "📅", title: "A calendar that is only yours", body: "Your group and semigroup, your optional courses and lab slots. Odd and even weeks, half-semester courses and holidays are already applied." },
    { icon: "🧪", title: "“Do I have lab this week?”", body: "Labs that run every other week are the classic trap. The app and Poli tell you which ones take place, and when a skipped one comes next." },
    { icon: "🧭", title: "The way to every room", body: "Type a room code such as B419 and watch a walkthrough through the university's 360° tour, from the building entrance to the door." },
    { icon: "🤖", title: "Poli, your assistant", body: "Ask in Romanian or English, by typing or by voice. Poli looks things up in your real timetable and can change your calendar for you." },
    { icon: "🤝", title: "Plan with your colleagues", body: "See when your friends are free, find a time that suits everyone and send a group invitation, even to people without an account." },
    { icon: "🔁", title: "Missed a lab?", body: "Find the other groups' sessions of the same lab this week, with the ones that fit your timetable first." },
    { icon: "📝", title: "Exams and a study plan", body: "Exam dates, rooms and reminders, plus a study plan that works backwards from each exam into your free time." },
    { icon: "✅", title: "Attendance, added up", body: "Mark what you attended and see where you stand per course before the session starts." },
    { icon: "📲", title: "On your phone's calendar", body: "Send yourself the calendar or subscribe to it from Google Calendar, Apple Calendar or Outlook." },
  ],
  freshers: {
    title: "New at UPT? Start here.",
    body: "The Guide explains serie, grupă and semigrupă, what C, S, L and P mean in the grid, how odd and even weeks are counted, and gives you a checklist for the first week.",
    words: ["serie", "grupă", "semigrupă", "curs", "laborator", "săptămână impară", "sesiune", "restanță", "credite"],
  },
  steps: {
    title: "Three steps and you are set",
    items: [
      { title: "Create your account", body: "An e-mail address and a password are all it needs." },
      { title: "Pick your group", body: "Faculty, year, programme and group, straight from the published timetables." },
      { title: "Open your week", body: "Your classes, rooms and exams are there. Poli is one tap away." },
    ],
  },
  closing: { title: "See your week in a minute.", cta: "Create a free account" },
  footer: {
    source: "Timetables and exams are read from the schedules that UPT's faculties publish. Always check official announcements for last-minute changes.",
    signIn: "Sign in",
    register: "Create account",
  },
};

const ro: typeof en = {
  notFound: { title: "Pagina nu a fost găsită", line: "Poli n-a găsit pagina asta. Hai să pornim din nou!" },
  title: "Orarul tău, descifrat",
  nav: { signIn: "Autentificare", start: "Începe", openApp: "Deschide calendarul meu" },
  hero: {
    badge: "Pentru studenții Politehnicii Timișoara",
    headline: "Orarul tău de la UPT, în sfârșit pe înțeles.",
    sub: "UPT Orar transformă tabelul mare al facultății în calendarul tău: doar orele grupei tale, în săptămânile în care chiar se țin, cu drumul până la fiecare sală și un asistent care îți răspunde în câteva secunde.",
    cta: "Creează-ți un cont gratuit",
    secondary: "Am deja cont",
    note: "Durează un minut: alegi facultatea, anul și grupa.",
  },
  preview: {
    week: "Săptămâna 9 · impară",
    days: ["Lun", "Mar", "Mie", "Joi", "Vin"],
    question: "Am laborator săptămâna aceasta?",
    answer: "Da — laborator de PC joi la 10:00, în B418a. Cel de fizică e săptămâna viitoare: se ține în săptămânile pare.",
    chip: "Drumul până la B418a",
    lecture: "Curs",
    lab: "Laborator",
    seminar: "Seminar",
  },
  stats: { groups: "grupe", classes: "ore importate", faculties: "facultăți", languages: "limbi: RO și EN" },
  featuresTitle: "Tot ce întreabă un boboc, cu răspuns",
  features: [
    { icon: "📅", title: "Un calendar doar al tău", body: "Grupa și semigrupa ta, opționalele și intervalele tale de laborator. Săptămânile pare și impare, disciplinele de jumătate de semestru și vacanțele sunt deja aplicate." },
    { icon: "🧪", title: "„Am laborator săptămâna asta?”", body: "Laboratoarele ținute o dată la două săptămâni sunt capcana clasică. Aplicația și Poli îți spun care se țin și când urmează cele sărite." },
    { icon: "🧭", title: "Drumul până la fiecare sală", body: "Scrie un cod de sală, de exemplu B419, și vezi un video prin turul 360° al universității, de la intrarea în clădire până la ușă." },
    { icon: "🤖", title: "Poli, asistentul tău", body: "Întreabă în română sau în engleză, în scris sau cu vocea. Poli caută în orarul tău real și îți poate modifica el calendarul." },
    { icon: "🤝", title: "Planifică împreună cu colegii", body: "Vezi când sunt liberi prietenii tăi, găsește o oră bună pentru toți și trimite o invitație de grup, chiar și celor fără cont." },
    { icon: "🔁", title: "Ai lipsit de la un laborator?", body: "Găsește ședințele celorlalte grupe la același laborator, săptămâna aceasta, cu cele care se potrivesc orarului tău puse primele." },
    { icon: "📝", title: "Examene și un plan de învățat", body: "Datele, sălile și alertele pentru examene, plus un plan de învățat care pornește de la fiecare examen înapoi, în timpul tău liber." },
    { icon: "✅", title: "Prezențele, adunate", body: "Marchează la ce ai fost și vezi cum stai la fiecare disciplină înainte să înceapă sesiunea." },
    { icon: "📲", title: "În calendarul telefonului", body: "Trimite-ți calendarul pe e-mail sau abonează-te la el din Google Calendar, Apple Calendar sau Outlook." },
  ],
  freshers: {
    title: "Ești nou la UPT? Începe de aici.",
    body: "Ghidul îți explică seria, grupa și semigrupa, ce înseamnă C, S, L și P în orar, cum se numără săptămânile pare și impare și îți dă o listă de făcut în prima săptămână.",
    words: ["serie", "grupă", "semigrupă", "curs", "laborator", "săptămână impară", "sesiune", "restanță", "credite"],
  },
  steps: {
    title: "Trei pași și ești gata",
    items: [
      { title: "Creează-ți contul", body: "O adresă de e-mail și o parolă sunt de ajuns." },
      { title: "Alege-ți grupa", body: "Facultatea, anul, specializarea și grupa, direct din orarele publicate." },
      { title: "Deschide-ți săptămâna", body: "Orele, sălile și examenele tale sunt acolo. Poli e la o atingere distanță." },
    ],
  },
  closing: { title: "Vezi-ți săptămâna într-un minut.", cta: "Creează-ți un cont gratuit" },
  footer: {
    source: "Orarele și examenele sunt citite din programele publicate de facultățile UPT. Verifică mereu anunțurile oficiale pentru schimbări de ultim moment.",
    signIn: "Autentificare",
    register: "Creează cont",
  },
};

export const landing = { en, ro };
