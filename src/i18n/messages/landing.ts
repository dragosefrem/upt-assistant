const en = {
  notFound: { title: "Page not found", line: "This address doesn’t lead to a page in Poli." },
  title: "You make the plans. Poli keeps the calendar.",
  nav: { signIn: "Sign in", openApp: "Open my calendar", sample: "See a sample week" },
  hero: {
    audience: "Your timetable assistant at UPT",
    headline: "You make the plans.",
    accent: "Poli keeps the calendar.",
    sub: "From classes to plans with friends, Poli knows your timetable and helps you find time together.",
    cta: "Create an account",
  },
  stage: {
    title: "From faculty files to your timetable",
    before: "From your faculty",
    files: ["timetable_sem1.pdf", "Lab groups.xlsx", "Exam dates.pdf"],
  },
  preview: {
    title: "Sample timetable",
    week: "Week 9 · odd",
    month: "November",
    days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
    shortDays: ["Mon", "Tue", "Wed", "Thu", "Fri"],
    courses: { maths: "Mathematical Analysis", coding: "Programming", physics: "Physics", logic: "Digital Logic", english: "English" },
    room: (code: string) => "Room " + code,
    free: "Free time",
  },
  ask: {
    heading: "Ask Poli",
    accent: "anything.",
    example: "Example from this timetable",
    prompts: [
      { question: "When am I free on Monday?", answer: "Your Programming lab ends at 12:00. Your English exam starts at 14:00, so you have two hours free." },
      { question: "Where’s my English exam?", answer: "Room D1, on Monday at 14:00. In your own calendar you can open the exam to get directions." },
      { question: "When is my next physics lab?", answer: "Wednesday, 12:00–14:00 in B305. You have a two-hour break after Digital Logic." },
    ],
  },
  stepsTitle: "Getting started",
  steps: [
    { title: "Choose your group", text: "Select your faculty, programme and group to see the timetable published for you." },
    { title: "Make the week yours", text: "Your fixed classes are already there. Pick your electives and lab times." },
    { title: "Set exam reminders", text: "See the published dates and rooms. Turn on a reminder for the exams you have coming up." },
  ],
  closing: { line: "You take care of yourself.", accent: "Poli takes care of the rest." },
  guide: { title: "New to UPT?", action: "Open the student guide" },
  source: "Based on timetables published by the faculties of Politehnica Timișoara.",
};

const ro: typeof en = {
  notFound: { title: "Pagina nu a fost găsită", line: "Nu există o pagină la această adresă în Poli." },
  title: "Tu ai planul. Poli are calendarul.",
  nav: { signIn: "Intră în cont", openApp: "Deschide calendarul", sample: "Vezi un exemplu de orar" },
  hero: {
    audience: "Asistentul tău de orar la UPT",
    headline: "Tu ai planul.",
    accent: "Poli are calendarul.",
    sub: "De la cursuri la planuri cu prietenii: AI-ul care-ți organizează ziua și-ți face loc pentru ce contează.",
    cta: "Creează-ți contul",
  },
  stage: {
    title: "Din orarele facultății în calendarul tău",
    before: "De la facultate",
    files: ["orar_sem1.pdf", "Grupe de laborator.xlsx", "Programare examene.pdf"],
  },
  preview: {
    title: "Exemplu de orar",
    week: "Săptămâna 9 · impară",
    month: "Noiembrie",
    days: ["Luni", "Marți", "Miercuri", "Joi", "Vineri"],
    shortDays: ["Lun", "Mar", "Mie", "Joi", "Vin"],
    courses: { maths: "Analiză matematică", coding: "Programare", physics: "Fizică", logic: "Logică digitală", english: "Engleză" },
    room: (code: string) => "Sala " + code,
    free: "Pauză",
  },
  ask: {
    heading: "Întreabă-l pe Poli",
    accent: "orice.",
    example: "Exemplu din acest orar",
    prompts: [
      { question: "Când am pauză luni?", answer: "Termini laboratorul de programare la 12:00 și ai examenul la engleză la 14:00. Ai două ore libere." },
      { question: "Unde am examenul la engleză?", answer: "În sala D1, luni la 14:00. În calendarul tău poți deschide examenul ca să vezi cum ajungi." },
      { question: "Când am laboratorul de fizică?", answer: "Miercuri, de la 12:00 la 14:00, în B305. Ai două ore de pauză după cursul de logică digitală." },
    ],
  },
  stepsTitle: "Cum începi",
  steps: [
    { title: "Alegi grupa", text: "Selectezi facultatea, programul de studii și grupa ca să vezi orarul publicat pentru tine." },
    { title: "Îți completezi orarul", text: "Cursurile cu oră fixă sunt deja în calendar. Tu alegi opționalele și orele de laborator." },
    { title: "Activezi alertele pentru examene", text: "Vezi datele și sălile publicate. Poți activa o notificare pentru examenele care urmează." },
  ],
  closing: { line: "Tu ai grijă de tine.", accent: "Poli are grijă de restul." },
  guide: { title: "Ești la început la UPT?", action: "Deschide ghidul studentului" },
  source: "Orarul se bazează pe programele publicate de facultățile Universității Politehnica Timișoara.",
};

export const landing = { en, ro };
