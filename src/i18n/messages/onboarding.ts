/** Texts for setting up a new account and the welcome tour shown on the first visit. */
const en = {
  steps: { account: "Account", group: "Your group", courses: "Your courses" },
  stepOf: (n: number, total: number) => `Step ${n} of ${total}`,
  signOut: "Sign out",
  profile: {
    title: "Set up your timetable",
    hello: (name: string) => `Welcome, ${name}!`,
    heading: "Where do you study?",
    intro: "Choose your faculty, programme and group to see the timetable for your year. You can change these in Settings.",
    helpTitle: "Not sure which group you are in?",
    help: [
      "Your faculty publishes the list of groups before the semester starts (on its website or notice board).",
      "A label such as 2.1 means group 2, semigroup 1. Seminars are per group, labs per semigroup, so pick it exactly.",
      "If your year is split into series (Seria 1, Seria 2), the series is part of the group's name in the list below.",
    ],
    submit: "Continue",
    adminEmpty: "You are the administrator of this installation and no timetables have been imported yet.",
    adminLink: "Open the admin page and run the UPT import",
    adminAfter: ", then come back to pick your group.",
    errors: {
      programme: "Choose your faculty and specialization.",
      year: "Choose your year of study.",
      offered: "Choose a programme offered for this year.",
      group: "Choose a group from this year's timetable.",
    },
  },
  courses: {
    title: "Choose your courses",
    heading: "Which classes do you follow?",
    almostDone: "Almost done",
    intro: "Some labs run in several slots and some courses are optional. Pick yours once, so the calendar shows only the classes you actually have.",
    submit: "Finish",
  },
  tour: {
    title: "Quick tour",
    skip: "Skip the tour",
    next: "Next",
    back: "Back",
    done: "Show me my week",
    openGuide: "Open the first-week guide",
    progress: (n: number, total: number) => `${n} of ${total}`,
    slides: [
      {
        emoji: "📅",
        title: (name: string) => `You are in, ${name}!`,
        body: "This is your calendar: only your group's classes, in the weeks they really take place. Odd and even weeks and holidays are already worked out, and the header shows which teaching week it is.",
      },
      {
        emoji: "🤖",
        title: () => "Meet Poli",
        body: "Ask “Do I have a lab this week?” in the chat. Poli can also find a free hour with a classmate or move an event.",
      },
      {
        emoji: "🧭",
        title: () => "Find a classroom",
        body: "Open any class and tap “Show me the way”, or go to Campus: you get a video walkthrough through the university's 360° tour, from the building entrance to the room.",
      },
      {
        emoji: "🎓",
        title: () => "New at UPT?",
        body: "The Guide has a checklist for your first week, explains serie, grupă and semigrupă, and shows the buildings you will actually use.",
      },
    ],
  },
};

const ro: typeof en = {
  steps: { account: "Cont", group: "Grupa ta", courses: "Disciplinele tale" },
  stepOf: (n: number, total: number) => `Pasul ${n} din ${total}`,
  signOut: "Deconectare",
  profile: {
    title: "Configurează-ți orarul",
    hello: (name: string) => `Bine ai venit, ${name}!`,
    heading: "Unde înveți?",
    intro: "Alege facultatea, specializarea și grupa ca să vezi orarul pentru anul tău. Le poți schimba din Setări.",
    helpTitle: "Nu știi sigur în ce grupă ești?",
    help: [
      "Facultatea publică listele cu grupele înainte de începerea semestrului (pe site sau la avizier).",
      "O etichetă ca 2.1 înseamnă grupa 2, semigrupa 1. Seminarele se țin pe grupă, laboratoarele pe semigrupă, așa că alege exact.",
      "Dacă anul tău e împărțit în serii (Seria 1, Seria 2), seria face parte din numele grupei din lista de mai jos.",
    ],
    submit: "Continuă",
    adminEmpty: "Ești administratorul acestei instalări și încă nu a fost importat niciun orar.",
    adminLink: "Deschide pagina de administrare și pornește importul UPT",
    adminAfter: ", apoi revino să-ți alegi grupa.",
    errors: {
      programme: "Alege-ți facultatea și specializarea.",
      year: "Alege-ți anul de studiu.",
      offered: "Alege un program oferit pentru acest an.",
      group: "Alege o grupă din orarul acestui an.",
    },
  },
  courses: {
    title: "Alege-ți disciplinele",
    heading: "La ce ore mergi?",
    almostDone: "Aproape gata",
    intro: "Unele laboratoare se țin în mai multe intervale, iar unele discipline sunt opționale. Alege-le o dată, ca să vezi în calendar doar orele pe care chiar le ai.",
    submit: "Finalizează",
  },
  tour: {
    title: "Tur rapid",
    skip: "Sari peste tur",
    next: "Înainte",
    back: "Înapoi",
    done: "Arată-mi săptămâna",
    openGuide: "Deschide ghidul primei săptămâni",
    progress: (n: number, total: number) => `${n} din ${total}`,
    slides: [
      {
        emoji: "📅",
        title: (name: string) => `Gata, ${name}, ești înăuntru!`,
        body: "Acesta e calendarul tău: doar orele grupei tale, în săptămânile în care chiar se țin. Săptămânile pare și impare și vacanțele sunt deja calculate, iar în antet vezi în a câta săptămână de școală ești.",
      },
      {
        emoji: "🤖",
        title: () => "Fă cunoștință cu Poli",
        body: "Întreabă în chat „Am laborator săptămâna asta?”. Poli te poate ajuta și să găsești o oră liberă cu un coleg sau să muți un eveniment.",
      },
      {
        emoji: "🧭",
        title: () => "Nu mai cauți sălile",
        body: "Deschide orice oră și apasă „Arată-mi drumul” sau mergi la Campus: primești un video prin turul 360° al universității, de la intrarea în clădire până la sală.",
      },
      {
        emoji: "🎓",
        title: () => "Ești nou la UPT?",
        body: "Ghidul are o listă de făcut în prima săptămână, îți explică seria, grupa și semigrupa și îți arată clădirile în care chiar ai ore.",
      },
    ],
  },
};

export const onboarding = { en, ro };
