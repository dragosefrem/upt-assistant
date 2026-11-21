# UPT Orar

A web app for students of Universitatea Politehnica Timișoara: a personal calendar of
classes and exams built from the timetables the faculties publish, with Google Calendar
export, directions to the next room, and a chat/voice assistant.

## What it does

- **Accounts.** Students register, then pick faculty → cycle → year → specialization →
  group. From year 3 they also choose which courses they follow, and for labs that run
  in several slots, which slot they attend.
- **Calendar home page.** Day / week / month views with today and the current time
  marked, plus an "up next" card. Classes follow the semester's teaching weeks
  (holidays, odd/even weeks, "weeks 1–7" courses).
- **Exams.** A student's own exam bookings, and search across the faculty's.
- **Changing your timetable.** Hide a class, move it to another slot, add personal
  events: click or drag on the calendar, or ask the assistant. Changes affect only you.
- **Directions.** With location sharing on, the app estimates how to reach the next
  room (walk / bike / transit / car), when to leave, and links to Google Maps.
- **Exam reminders.** The exams page shows each upcoming exam with a countdown, the
  room and building, a map link and a few tips from Poli, plus a search across the
  faculty's exams. A bell in the header lists exams in the next 30 days and can notify
  the device a week, a day, 2 hours and 30 minutes before (while the app is open); the
  Google Calendar and `.ics` exports carry alerts a day and 2 hours before each exam.
- **Poli.** The assistant's mascot. Pressing any Poli opens the chat; it also greets the
  student with one-tap questions on the calendar page. Placeholder images live in
  `public/images`; `docs/IMAGINI.md` has prompts for the final artwork.
- **Assistant.** Text chat and voice (speech recognition and read-aloud in the
  browser), in Romanian or English: "Unde am examenul la AC?", "When is group TI 3.2
  free on Monday?", "Hide the PM lecture".
- **Export.** One-click sync to a dedicated Google calendar, or an `.ics` file /
  subscription link.
- **Admin.** A scraping engine reads the university structure from upt.ro and each
  faculty's timetable and exam documents, and replaces what is in the database.

## Getting started

Requires Node.js 20.9 or newer. The timetable importer also uses Python 3.8 or newer and pdfplumber to read the five faculties that publish PDFs.

```bash
npm install
python3 -m venv .venv
.venv/bin/python -m pip install -r scripts/requirements-timetables.txt
cp .env.example .env.local   # optional — everything has a working default
npm run dev                  # http://localhost:3000
```

1. Register. **The first account becomes the administrator.**
2. Open **Admin → Scrape UPT** and run it, or run `npm run scrape`.
3. Finish onboarding by choosing your group.

The SQLite database is created at `data/upt.db` on first start; migrations and seed
data (the 2026–2027 academic calendar and campus buildings) are applied automatically.

### Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` / `npm run build` / `npm start` | Development server / production build / production server |
| `npm run scrape` | Run the scraper from the terminal. Flags: `--only=AC,MPT`, `--no-catalog`, `--no-timetables`, `--no-exams`, `--dry-run` |
| `npm test` | Unit tests, including parsers run against real UPT documents in `tests/fixtures` |
| `npm run typecheck` / `npm run lint` | TypeScript / ESLint |
| `npm run db:generate` | Generate a migration after editing `src/db/schema.ts` |

### Configuration

All optional; see `.env.example`.

| Variable | Effect |
| --- | --- |
| `ANTHROPIC_API_KEY` | Connects the assistant to Claude. Without it a built-in keyword assistant answers the common questions. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APP_URL` | Enables direct Google Calendar export. Without them students still have the `.ics` file and subscription link. |
| `ADMIN_EMAILS` | Comma-separated addresses that become administrators when they register. |
| `DATABASE_PATH` | Where the SQLite file lives (default `data/upt.db`). |
| `TIMETABLE_PYTHON` | Python executable with pdfplumber installed. Defaults to the project's virtual environment, then to `python3`. |

**Google Calendar.** Create an OAuth client (type "Web application") in Google Cloud,
enable the Google Calendar API, and add `<APP_URL>/api/google/callback` as an
authorised redirect URI. The app requests only the `calendar.app.created` scope: it
creates its own "UPT Orar" calendar and cannot see anything else in the account.

**Claude.** The assistant runs on Claude Managed Agents: Anthropic hosts the agent
loop, and this app answers its tool calls from the local database. The agent and its
environment are created on first use and their ids are stored in the `settings` table;
each student gets their own session. The integration lives in
`src/lib/assistant/claude.ts`; the tools both assistants share are in
`src/lib/assistant/tools.ts`.

## What the scraper covers

The importer follows the university timetable directory and the Robotics & AI faculty's
own timetable page for the selected semester. Students can open the published documents
from Settings, including local copies of the PDFs.

| Faculty | Published as | Result |
| --- | --- | --- |
| AC | Excel workbooks on SharePoint (timetables and exam sessions) | Imported, including exams |
| ETcTI | Published Google Sheets | Imported |
| MPT | Excel workbook | Imported |
| FSC | Excel workbooks | Imported |
| CT, MEC, IEE, CHIM | PDF | Classes imported by programme, year and published group |
| FAUT | PDF on Nextcloud | Classes imported from the year columns |
| FIH | Interactive faculty timetable | Classes imported per cohort and subgroup |
| Robotics & AI | Excel workbooks | Classes imported from the public programme and year sheets |

The picker shows the programmes with classes for the chosen year. At AC, Romanian
CTI students share a first-year timetable. Calculatoare and Tehnologia informației
have separate groups from year 2, and the English Calculatoare programme has its
own groups throughout. A programme whose timetable is unavailable can still be selected.

The importer checks the academic term printed on PDF pages and records conflicting
pages in the import log and Settings. Students can read the original while the
calendar uses the pages that match its semester. The public Campus Virtual calendar
supplies dated classes and assessments for Informatică, TST and CRP distance learning
and TCM reduced-attendance programmes. These events show the published start time.

- **Optional courses.** Published elective sections and courses marked optional by an
  administrator start unticked. From year 3, students can also choose their other courses.
- **Where rooms are.** Faculty buildings come from upt.ro with coordinates. Room codes
  are mapped to buildings by patterns seeded in `src/db/seed.ts`, taken from AC's room
  legend. Three of those (ASPC, SPM, Hidrotehnică) were placed from their street address
  and are flagged as approximate in the UI — worth correcting in the `buildings` table.

Exam sessions are filled in by faculties as the session approaches, so re-run the
scrape then.

### How it is organised

```
src/scraper/
  http.ts          fetch with cookies across redirects (SharePoint needs them)
  catalog.ts       faculties, programmes, specializations from upt.ro
  discover.ts      find and classify document links on faculty pages
  grid.ts          Excel workbooks and HTML tables → one grid model with merged cells
  timetable.ts     generic grid parser: hour column, day blocks, group headers, slot notes
  printed.ts       resolve printed cells against programme columns, days and hour ranges
  pdf.ts           read PDF tables and check the term printed on each page
  cellText.ts      one cell → course, type, room, teacher, weeks
  exams.ts         room-booking exam grids
  adapters/        per-faculty knowledge: where documents are, how sheets map to groups
  apply.ts         write to the database, replacing what a document supplied before
  engine.ts        orchestrates a run and records its log
src/lib/           schedule resolution, exports, directions, auth, assistant
src/app/           pages and API routes
```

To add a faculty, write an adapter in `src/scraper/adapters/` (see `others.ts` for
three short ones) and register it in `adapters/index.ts`. `npx tsx scripts/dev-parse.ts
<file>` prints what the generic parser makes of a downloaded workbook.

Re-scraping keeps entry ids stable where a class has not changed, so students' hidden
or moved classes survive an update.

## Notes for running it for real

- **Database.** SQLite keeps setup to zero and suits a single server. The schema is
  plain Drizzle; moving to Postgres means swapping the driver in `src/db/index.ts` and
  the column helpers in `schema.ts`.
- **Background scrapes** run inside the web process. On a serverless host, trigger
  `npm run scrape` from a scheduled job instead.
- **Not built yet:** e-mail verification, password reset and sign-in rate limiting.
  Google refresh tokens are stored unencrypted in the database.
- **Academic calendar.** Semester dates for 2026–2027 are seeded from Senate decision
  HS 26/19.03.2026; next year's need adding to `src/db/seed.ts` (or the `semesters`
  table) and selecting under Admin → Semester.
- **Time zone.** All times are Europe/Bucharest wall-clock, independent of the server's.
