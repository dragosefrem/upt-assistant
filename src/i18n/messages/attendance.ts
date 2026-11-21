/** Texts for the "attendance" part of the interface: the Attendance page and marking an occurrence. */
const en = {
  title: "Attendance",
  intro:
    "Every recurring class, exam and personal event you marked, each with its own statistics. Open an event in the calendar to mark it — each date is recorded on its own.",
  overall: "Overall summary",
  attended: "Attended",
  missed: "Missed",
  rate: "Rate",
  attendanceRate: "Attendance rate",
  markAttended: "✓ Attended",
  markMissed: "✗ Missed",
  datesFor: (title: string) => `Dates for ${title}`,
  emptyBefore: "Nothing marked yet. Open a class in the ",
  emptyLink: "calendar",
  emptyAfter: " and choose Attended or Missed.",
  /** Labels of the details list on each series card. */
  fields: {
    course: "Course",
    event: "Event",
    abbr: "Abbreviation",
    type: "Type",
    date: "Date",
    when: "When",
    weeks: "Weeks",
    room: "Room",
    location: "Location",
    building: "Building",
    teacher: "Teacher",
    audience: "Audience",
    note: "Note",
  },
  /** Short notes about a series, from `seriesDetails`. */
  details: {
    everyWeek: "Every week",
    once: "Once",
    hidden: "hidden from your timetable",
    notOnTimetable: "not on your timetable any more",
    gone: "no longer in your calendar — details as saved when you marked it",
  },
  errors: {
    notYet: "This event has not happened yet. You can mark attendance from its day onwards.",
    notInCalendar: "This event is no longer in your calendar.",
    invalidRequest: "Invalid request",
  },
};

const ro: typeof en = {
  title: "Prezențe",
  intro:
    "Fiecare oră, examen și eveniment personal recurent pe care l-ai marcat, fiecare cu statisticile lui. Deschide un eveniment în calendar ca să-l marchezi — fiecare dată se înregistrează separat.",
  overall: "Rezumat general",
  attended: "Prezent",
  missed: "Absent",
  rate: "Procent",
  attendanceRate: "Rata de prezență",
  markAttended: "✓ Prezent",
  markMissed: "✗ Absent",
  datesFor: (title: string) => `Datele pentru ${title}`,
  emptyBefore: "Nu ai marcat nimic încă. Deschide o oră în ",
  emptyLink: "calendar",
  emptyAfter: " și alege Prezent sau Absent.",
  fields: {
    course: "Disciplina",
    event: "Eveniment",
    abbr: "Abreviere",
    type: "Tip",
    date: "Data",
    when: "Când",
    weeks: "Săptămâni",
    room: "Sala",
    location: "Locul",
    building: "Clădirea",
    teacher: "Cadru didactic",
    audience: "Pentru",
    note: "Observații",
  },
  details: {
    everyWeek: "În fiecare săptămână",
    once: "O singură dată",
    hidden: "ascuns din orarul tău",
    notOnTimetable: "nu mai e în orarul tău",
    gone: "nu mai e în calendarul tău — detaliile sunt cele salvate când l-ai marcat",
  },
  errors: {
    notYet: "Evenimentul nu a avut loc încă. Poți marca prezența începând din ziua lui.",
    notInCalendar: "Evenimentul nu mai e în calendarul tău.",
    invalidRequest: "Cerere invalidă",
  },
};

export const attendance = { en, ro };
