const en = {
  notFound: { title: "Page not found", line: "This address doesn’t lead to a page in Poli." },
  title: "Your student timetable",
  nav: { signIn: "Sign in", openApp: "Open my calendar" },
  hero: {
    audience: "Politehnica Timișoara",
    headline: "Your group’s",
    accent: "timetable.",
    sub: "Find your next class, its room and the free time in between. Labs that meet every other week appear on the right dates.",
    cta: "Create an account",
    note: "Free for UPT students. Choose your group when you sign up.",
  },
  preview: {
    title: "Sample timetable",
    week: "Week 9 · odd",
    month: "November",
    days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
    shortDays: ["Mon", "Tue", "Wed", "Thu", "Fri"],
    courses: { maths: "Mathematical Analysis", coding: "Programming", physics: "Physics", logic: "Digital Logic", english: "English" },
    room: (code: string) => `Room ${code}`,
  },
  features: {
    heading: "Between classes",
    campus: { title: "Find your classroom", body: "Look up a classroom and explore its building in the UPT virtual tour." },
    contacts: { title: "Meet up with classmates", body: "Compare calendars, find a free hour and invite your group." },
    poli: { title: "Ask Poli", body: "Ask when your next lab is or where you need to be. Poli checks your timetable and answers in English or Romanian." },
  },
  guide: { title: "New to UPT?", action: "Open the student guide" },
  source: "Timetables come from the schedules published by UPT faculties. Check faculty announcements for last-minute changes.",
};

const ro: typeof en = {
  notFound: { title: "Pagina nu a fost găsită", line: "Nu există o pagină la această adresă în Poli." },
  title: "Orarul tău de student",
  nav: { signIn: "Intră în cont", openApp: "Deschide calendarul" },
  hero: {
    audience: "Politehnica Timișoara",
    headline: "Orarul",
    accent: "grupei tale.",
    sub: "Vezi când ai ore, în ce sală și când ai pauză. Laboratoarele din două în două săptămâni apar în zilele în care se țin.",
    cta: "Creează un cont",
    note: "Gratuit pentru studenții UPT. Alegi facultatea, anul și grupa.",
  },
  preview: {
    title: "Exemplu de orar",
    week: "Săptămâna 9 · impară",
    month: "Noiembrie",
    days: ["Luni", "Marți", "Miercuri", "Joi", "Vineri"],
    shortDays: ["Lun", "Mar", "Mie", "Joi", "Vin"],
    courses: { maths: "Analiză matematică", coding: "Programare", physics: "Fizică", logic: "Logică digitală", english: "Engleză" },
    room: (code: string) => `Sala ${code}`,
  },
  features: {
    heading: "Între cursuri",
    campus: { title: "Găsește sala", body: "Caută o sală și explorează clădirea în turul virtual al UPT." },
    contacts: { title: "Întâlnește-te cu colegii", body: "Compară orarele, găsește o oră liberă și invită-ți colegii." },
    poli: { title: "Întreabă-l pe Poli", body: "Află când ai următorul laborator sau în ce sală trebuie să ajungi. Poli verifică orarul și răspunde în română sau engleză." },
  },
  guide: { title: "Ești la început la UPT?", action: "Deschide ghidul studentului" },
  source: "Orarul se bazează pe programele publicate de facultățile UPT. Pentru schimbări de ultim moment, verifică anunțurile facultății.",
};

export const landing = { en, ro };
