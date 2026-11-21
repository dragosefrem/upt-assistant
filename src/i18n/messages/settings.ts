/** Texts for the "settings" part of the interface: the Settings page, profile and course pickers, calendar export. */
const en = {
  page: {
    title: "Settings",
    signedInAs: (email: string, role: string) => `Signed in as ${email} · ${role}`,
    roles: { student: "student", admin: "administrator" } as Record<string, string>,
  },
  language: {
    title: "Language · Limbă",
    hint: "The app, the calendar e-mail and your calendar subscription use this language.",
  },
  study: {
    title: "Where you study",
    hint: "Changing your group resets your optional-course choices and the classes you hid or moved.",
  },
  courses: {
    title: "Courses and lab slots",
    hidden: "Classes you’ve hidden",
    restore: "Show in calendar",
    save: "Save choices",
  },
  documents: {
    title: (faculty: string) => `Published timetables — ${faculty}`,
    hint: "Timetables published by your faculty for the current semester.",
    status: {
      imported: "imported",
      partial: "partial",
      failed: "failed",
      discovered: "found",
    } as Record<string, string>,
    empty: "Nothing found for this semester.",
    seeBefore: "See the ",
    facultyPage: "faculty’s timetable page",
    seeAfter: ".",
  },

  /** ProfilePicker: faculty → cycle → year → specialization → group. */
  profile: {
    facultyPlaceholder: "Choose your faculty",
    faculty: "Faculty",
    chooseFaculty: "Choose your faculty to continue.",
    chooseYear: "Choose your year to continue.",
    noCycle: "No programmes are listed for this study cycle. Choose a different cycle or faculty.",
    chooseProgramme: "Choose your programme to continue.",
    chooseGroup: "Choose your group to continue.",
    noFaculties: "No faculties have been imported yet. An administrator needs to run the UPT scrape first.",
    cycleAndYear: "Study cycle and year",
    bachelor: "Bachelor (licență)",
    master: "Master",
    year: (n: number) => `Year ${n}`,
    specialization: "Specialization",
    teachingLanguage: { RO: "Romanian", EN: "English" } as Record<string, string>,
    sharedFirstYear: "Shared first year for Calculatoare and Tehnologia informației",
    withoutTimetable: (year: number) => `Programmes without a year ${year} timetable this semester`,
    noProgrammes: "No programmes listed for this year.",
    group: "Group",
    wholeYear: "Whole year",
    noClasses: "No classes are available for this programme and year. You can continue without a group",
    noClassesOpen: " and open the ",
    facultyPage: "faculty’s timetable page",
    noClassesEnd: ".",
  },

  /** CourseChoicesForm. */
  choices: {
    slotNotChosen: "Choose later",
    slotFor: (course: string) => `Lab or seminar slot for ${course}`,
    yourCourses: "Course choices",
    yourCoursesHint:
      "Select the courses you attend. Your group’s other courses are already in your timetable.",
    optional: "optional",
    slotsTitle: "Lab and seminar slots",
    slotsHint: "Choose the time you attend. The session appears in your timetable once you choose a slot.",
    nothing: "Nothing to choose: your group has no optional courses or alternative lab slots this semester.",
  },

  /** ExportPanel and the export API routes. */
  export: {
    title: "Export your calendar",
    flash: {
      synced: "Connected. Your timetable is now in the “Poli” calendar in Google Calendar.",
      denied: "Google access was not granted, so nothing was exported.",
      failed: "Connecting to Google failed. Please try again.",
      unconfigured: "Google Calendar export is not configured on this server.",
    } as Record<string, string>,
    email: {
      title: "Send to your e-mail",
      hint: "Get your classes, exams, own events and confirmed group events as a calendar file. Open it on your phone, or import it into Google Calendar, Apple Calendar or Outlook.",
      address: "E-mail address",
      send: "E-mail my calendar",
      sending: "Sending…",
      snapshot: "The file is a snapshot, so send it again after you change courses or events, or subscribe with the link below to stay in sync.",
      notConfigured: "E-mail isn’t set up on this server yet (it needs SMTP settings). Meanwhile, download the file below.",
      sent: (to: string) => `Sent to ${to}. Open the attached poli.ics, or import it into your calendar (the e-mail explains how).`,
      failed: "The e-mail could not be sent.",
    },
    file: {
      title: "Calendar file and subscription link",
      hintBefore: "Works with Google Calendar (",
      hintPath: "Other calendars → From URL",
      hintAfter: "), Apple Calendar and Outlook. Anyone with the link can see your timetable, so keep it private.",
      download: "Download .ics",
      copy: "Copy subscription link",
      copied: "Link copied",
      renew: "Get a new link",
      renewHint: "The old link stops working immediately. Use the new link to subscribe again.",
      renewed: "Your new subscription link is ready to copy.",
    },
    google: {
      title: "Google Calendar",
      hint: "Creates a separate calendar called “Poli” in your Google account with your classes, exams, personal events and confirmed group events you’re attending. The app can only see and change that one calendar.",
      exportAgain: "Export again",
      exporting: "Exporting…",
      disconnect: "Disconnect",
      connect: "Connect Google Calendar",
      lastExport: (when: string) => `Last export ${when}`,
      refreshHint: "Export again after your timetable or group RSVPs change to update your Google calendar.",
      exported: (n: number) => `Exported ${n} ${n === 1 ? "item" : "items"} to Google Calendar.`,
      unreachable: "Google Calendar could not be reached.",
      disconnected: "Disconnected. The calendar already in your Google account was left in place.",
      notConnected: "Google Calendar is not connected.",
      revoked: "Google access was revoked. Connect Google Calendar again.",
      replied: (detail: string) => `Google Calendar returned an error: ${detail}`,
    },
    errors: {
      mailNotConfigured: "E-mail isn't set up on this server yet, so download the .ics file instead.",
      badAddress: "That doesn’t look like an e-mail address.",
      emptyCalendar: "Your calendar is empty. Choose your group or add an event first.",
      wait: (seconds: number) => `Your calendar was just sent. Please wait ${seconds} seconds before sending it again.`,
      sendFailed: "The e-mail could not be sent. Please try again later.",
      notFound: "Not found",
    },
  },

  /** The calendar file itself (.ics feed, Google Calendar): event titles and descriptions. */
  calendarFile: {
    exam: (course: string) => `Exam: ${course}`,
    room: (room: string) => `Room ${room}`,
    movedFrom: (date: string) => `moved from ${date}`,
    goodLuck: "Good luck! 🍀",
  },

  /** The "Email my calendar" message. */
  mail: {
    subject: "Your UPT timetable",
    greeting: "Hi,",
    attached: (semester: string | null) =>
      `Your UPT timetable is attached as poli.ics: your classes, exams and own events${semester ? ` for ${semester}` : ""}.`,
    howTo: "To add it to your calendar:",
    google:
      "- Google Calendar, on a computer: Settings > Import & export > Import, choose poli.ics and the calendar to add it to. Tip: create a calendar called \"Poli\" first, so you can remove it all in one go later.",
    apple: "- iPhone, iPad or Mac: open the attachment and choose Add All.",
    outlook: "- Outlook: open the attachment and add it to your calendar.",
    snapshot:
      "The file is a snapshot of your calendar today. After you change your group, courses or events, send it again from Settings > Export your calendar.",
    subscribe:
      "To stay in sync automatically instead, subscribe to this link (in Google Calendar: Other calendars > + > From URL). Anyone with the link can see your timetable, so keep it to yourself:",
    signature: "Poli",
  },
};

const ro: typeof en = {
  page: {
    title: "Setări",
    signedInAs: (email: string, role: string) => `Conectat ca ${email} · ${role}`,
    roles: { student: "student", admin: "administrator" },
  },
  language: {
    title: "Limbă · Language",
    hint: "Aplicația, e-mailul cu calendarul și abonamentul la calendar folosesc limba aleasă.",
  },
  study: {
    title: "Unde studiezi",
    hint: "Dacă schimbi grupa, se resetează disciplinele opționale alese și orele pe care le-ai ascuns sau mutat.",
  },
  courses: {
    title: "Discipline și ore de laborator",
    save: "Salvează alegerile",
    hidden: "Orele pe care le-ai ascuns",
    restore: "Afișează în calendar",
  },
  documents: {
    title: (faculty: string) => `Orare publicate — ${faculty}`,
    hint: "Orarele publicate de facultatea ta pentru semestrul curent.",
    status: {
      imported: "importat",
      partial: "parțial",
      failed: "eșuat",
      discovered: "găsit",
    },
    empty: "Nu am găsit nimic pentru semestrul acesta.",
    seeBefore: "Vezi ",
    facultyPage: "pagina cu orare a facultății",
    seeAfter: ".",
  },

  profile: {
    facultyPlaceholder: "Alege facultatea",
    faculty: "Facultatea",
    chooseFaculty: "Alege facultatea ca să continui.",
    chooseYear: "Alege anul de studiu ca să continui.",
    noCycle: "Nu sunt programe pentru acest ciclu de studii. Alege alt ciclu sau altă facultate.",
    chooseProgramme: "Alege specializarea ca să continui.",
    chooseGroup: "Alege grupa ca să continui.",
    noFaculties: "Nu a fost importată încă nicio facultate. Un administrator trebuie să ruleze mai întâi importul de pe upt.ro.",
    cycleAndYear: "Ciclul de studii și anul",
    bachelor: "Licență",
    master: "Master",
    year: (n: number) => `Anul ${n}`,
    specialization: "Specializarea",
    teachingLanguage: { RO: "română", EN: "engleză" },
    sharedFirstYear: "An I comun pentru Calculatoare și Tehnologia informației",
    withoutTimetable: (year: number) => `Programe fără orar pentru anul ${year} în semestrul acesta`,
    noProgrammes: "Niciun program de studii pentru anul acesta.",
    group: "Grupa",
    wholeYear: "Tot anul",
    noClasses: "Nu există ore pentru acest program și an. Poți continua fără grupă",
    noClassesOpen: " și poți deschide ",
    facultyPage: "pagina cu orare a facultății",
    noClassesEnd: ".",
  },

  choices: {
    slotNotChosen: "Aleg mai târziu",
    slotFor: (course: string) => `Interval de laborator sau seminar pentru ${course}`,
    yourCourses: "Discipline la alegere",
    yourCoursesHint:
      "Bifează disciplinele la care mergi. Celelalte discipline ale grupei sunt deja în orar.",
    optional: "opțional",
    slotsTitle: "Ore de laborator și seminar",
    slotsHint: "Alege intervalul la care mergi. Ora apare în orar după ce alegi un interval.",
    nothing: "Nu ai ce alege: grupa ta nu are discipline opționale sau intervale alternative de laborator în semestrul acesta.",
  },

  export: {
    title: "Exportă calendarul",
    flash: {
      synced: "Gata, conectat. Orarul tău e acum în calendarul „Poli” din Google Calendar.",
      denied: "Nu ai dat acces la Google, așa că nu s-a exportat nimic.",
      failed: "Conectarea la Google nu a reușit. Încearcă din nou.",
      unconfigured: "Exportul în Google Calendar nu e configurat pe acest server.",
    },
    email: {
      title: "Trimite pe e-mail",
      hint: "Primește orele, examenele, evenimentele tale și evenimentele de grup confirmate într-un fișier de calendar. Deschide-l pe telefon sau importă-l în Google Calendar, Apple Calendar ori Outlook.",
      address: "Adresa de e-mail",
      send: "Trimite-mi calendarul",
      sending: "Se trimite…",
      snapshot: "Fișierul surprinde calendarul de acum, așa că trimite-l din nou după ce schimbi disciplinele sau evenimentele — sau abonează-te cu linkul de mai jos ca să rămână mereu la zi.",
      notConfigured: "Trimiterea de e-mailuri nu e încă configurată pe acest server (are nevoie de setări SMTP). Până atunci, descarcă fișierul de mai jos.",
      sent: (to: string) => `Trimis la ${to}. Deschide atașamentul poli.ics sau importă-l în calendarul tău (în e-mail scrie cum).`,
      failed: "E-mailul nu a putut fi trimis.",
    },
    file: {
      title: "Fișier de calendar și link de abonare",
      hintBefore: "Merge cu Google Calendar (",
      hintPath: "Alte calendare → Din adresa URL",
      hintAfter: "), Apple Calendar și Outlook. Oricine are linkul îți poate vedea orarul, așa că păstrează-l doar pentru tine.",
      download: "Descarcă .ics",
      copy: "Copiază linkul de abonare",
      copied: "Link copiat",
      renew: "Generează un link nou",
      renewHint: "Linkul vechi expiră imediat. Pentru abonare, folosește-l pe cel nou.",
      renewed: "Poți copia acum noul link de abonare.",
    },
    google: {
      title: "Google Calendar",
      hint: "Creează în contul tău Google un calendar separat, „Poli”, cu orele, examenele, evenimentele personale și evenimentele de grup confirmate la care participi. Aplicația poate vedea și modifica doar acel calendar.",
      exportAgain: "Exportă din nou",
      exporting: "Se exportă…",
      disconnect: "Deconectează",
      connect: "Conectează Google Calendar",
      lastExport: (when: string) => `Ultimul export: ${when}`,
      refreshHint: "Exportă din nou după ce se schimbă orarul sau răspunsurile la evenimentele de grup, ca să se actualizeze calendarul Google.",
      exported: (n: number) =>
        `Am exportat ${n === 1 ? "un eveniment" : n < 20 ? `${n} evenimente` : `${n} de evenimente`} în Google Calendar.`,
      unreachable: "Google Calendar nu a putut fi contactat.",
      disconnected: "Deconectat. Calendarul deja existent în contul tău Google a rămas neatins.",
      notConnected: "Google Calendar nu e conectat.",
      revoked: "Accesul la Google a fost retras. Conectează din nou Google Calendar.",
      replied: (detail: string) => `Google Calendar a răspuns cu o eroare: ${detail}`,
    },
    errors: {
      mailNotConfigured: "Trimiterea de e-mailuri nu e încă configurată pe acest server, așa că descarcă fișierul .ics.",
      badAddress: "Asta nu pare o adresă de e-mail.",
      emptyCalendar: "Calendarul tău e gol. Alege-ți mai întâi grupa sau adaugă un eveniment.",
      wait: (seconds: number) =>
        `Calendarul tocmai a fost trimis. Mai așteaptă ${seconds === 1 ? "o secundă" : seconds < 20 ? `${seconds} secunde` : `${seconds} de secunde`} până îl trimiți din nou.`,
      sendFailed: "E-mailul nu a putut fi trimis. Încearcă din nou mai târziu.",
      notFound: "Nu a fost găsit",
    },
  },

  calendarFile: {
    exam: (course: string) => `Examen: ${course}`,
    room: (room: string) => `Sala ${room}`,
    movedFrom: (date: string) => `mutat de pe ${date}`,
    goodLuck: "Baftă! 🍀",
  },

  mail: {
    subject: "Orarul tău UPT",
    greeting: "Salut,",
    attached: (semester: string | null) =>
      `Ți-am atașat orarul UPT în fișierul poli.ics: orele, examenele și evenimentele tale${semester ? ` din ${semester}` : ""}.`,
    howTo: "Ca să-l adaugi în calendar:",
    google:
      "- Google Calendar, de pe calculator: Setări > Importă și exportă > Importă, alege poli.ics și calendarul în care să-l adaugi. Sfat: creează mai întâi un calendar numit „Poli”, ca să-l poți șterge dintr-odată mai târziu.",
    apple: "- iPhone, iPad sau Mac: deschide atașamentul și alege Adaugă tot.",
    outlook: "- Outlook: deschide atașamentul și adaugă-l în calendar.",
    snapshot:
      "Fișierul surprinde calendarul tău de azi. După ce îți schimbi grupa, disciplinele sau evenimentele, trimite-l din nou din Setări > Exportă calendarul.",
    subscribe:
      "Dacă vrei să rămână la zi automat, abonează-te la linkul de mai jos (în Google Calendar: Alte calendare > + > Din adresa URL). Oricine are linkul îți poate vedea orarul, așa că păstrează-l doar pentru tine:",
    signature: "Poli",
  },
};

export const settings = { en, ro };
