# Poli

A web app for students of Universitatea Politehnica Timișoara, built first of all for
first-years: a personal calendar made from the timetables the faculties publish, the
way to every room, an assistant (Poli) that answers and acts on the student's behalf,
and the tools to plan time with colleagues and prepare for the exam session. Everything
works in Romanian and English.

## What it does

- **Welcome page and accounts.** Signed-out visitors get a public page that explains the
  app. New students confirm their e-mail before choosing a password. They can recover access through a
  one-time link sent by e-mail.
- **Onboarding.** Faculty → cycle and year → programme → group, with a step indicator
  and help on what "grupă" and "semigrupă" mean. From year 3 (and wherever a lab runs in
  several slots) students also choose their courses and lab slots. A short welcome tour
  follows on the first visit.
- **Calendar.** Day / week / month views of only the student's own classes, in the weeks
  they really take place (holidays, odd and even weeks, "weeks 1–7" courses, dated
  meetings). Romania's public holidays, including the movable Orthodox ones, are shown
  and classes do not take place on them (`src/lib/holidays.ts`). Click or drag to add personal events; hide a class, move it every week or
  for one week only. Changes affect only the student.
- **Labs this week.** A card on the home page answers "do I have lab this week?": the
  teaching week and its parity, the labs, seminars and projects that take place, and the
  ones that do not, with the date they come next.
- **Make-up sessions.** From a lab in the calendar, "Find a make-up session" lists the
  other groups' sessions of the same lab, the ones that fit the student's timetable first.
- **Campus.** A door-to-door journey to a room: an embedded Google map from where the
  student is to the best building entrance, then a video walkthrough through the
  university's 360° tour from that entrance to the room, with step-by-step directions.
  Built on Campuspath (`services/campuspath`), which also offers a classroom directory.
- **Exams and study plan.** Exam dates, rooms, countdowns and reminders; a search across
  the faculty's exams; and a study planner that works backwards from each exam and puts
  study blocks into the student's free time.
- **Attendance.** Set a semester minimum separately for each course’s lectures, labs,
  seminars and other classes. The Attendance tab shows how many more sessions you need.
  Mark sessions from the calendar and review individual dates in History.
- **Contacts and group events.** Link accounts with colleagues (requests are accepted
  by the other person; real calendars then count as busy time), or save a friend as a
  name plus a group. See shared free time over custom dates, book a group event, collect
  answers, and invite people without an account through a guest link.
- **Poli, the assistant.** Chat or talk in Romanian or English. Poli looks everything up
  in the student's real data and can do whatever the interface can; see "The assistant"
  below.
- **Guide.** A first-week checklist, the semester at a glance, how to read a faculty
  timetable, a glossary of the words first-years meet (serie, grupă, semigrupă,
  restanță, …) and the buildings the student actually uses.
- **Export.** The calendar by e-mail as an `.ics` file, a subscription link, or (when
  configured) one-way or two-way sync with the dedicated **Poli** Google calendar. Exports are written in the
  account's language.
- **Admin.** A scraping engine reads the university structure from upt.ro and each
  faculty's timetable and exam documents, and replaces what is in the database.

## Getting started

Requires Node.js 20.9 or newer. Two optional parts use Python 3.11 or newer, each with its
own virtual environment because their dependencies conflict: the timetable importer
(for the faculties that publish PDFs) and Campuspath (walkthrough videos, which also
need `ffmpeg` on the PATH).

```bash
npm install
cp .env.example .env.local   # configure a verification sender for registration

# timetable PDFs
python3 -m venv .venv
.venv/bin/python -m pip install -r scripts/requirements-timetables.txt

# campus walkthroughs
python3 -m venv services/campuspath/.venv
services/campuspath/.venv/bin/python -m pip install -r services/campuspath/requirements.txt

npm run dev                  # http://localhost:3000
```

1. Configure a verification sender in `.env.local` using the variables below. Open **Create account**, enter your e-mail and follow the link to choose a name and password. **The first completed account becomes the administrator.**
2. Open **Admin → Scrape UPT** and run it, or run `npm run scrape`.
3. Finish onboarding by choosing your group.

The SQLite database is created at `data/upt.db` on first start; migrations and seed
data (the 2026–2027 academic calendar and campus buildings) are applied automatically.
Databases from main, the Google Calendar previews, and the attendance-goals branch
upgrade in place. Databases from feature branches that predate the unified schema
still require a fresh database.

### Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` / `npm run build` / `npm start` | Development server / production build / production server |
| `npm run scrape` | Run the scraper from the terminal. Flags: `--only=AC,MPT`, `--no-catalog`, `--no-timetables`, `--no-exams`, `--dry-run` |
| `npm test` | Unit tests, including parsers run against real UPT documents in `tests/fixtures` |
| `npm run typecheck` / `npm run lint` | TypeScript / ESLint |
| `npm run db:generate` | Generate a migration after editing `src/db/schema.ts` |
| `cd services/campuspath && .venv/bin/python -m unittest discover -s tests` | Campuspath's own tests |

The production setup and first-release steps are in [Deploying UPT to Railway](docs/railway.md).

### Google Calendar sync

Under **Settings → Calendar sync and export**, choose a direction for the **Poli** calendar
and select **Connect Google Calendar**. You can change direction later on the same calendar.

- **One-way** publishes your Poli timetable to Google. Changing or deleting a published
  event in Google restores the Poli version on the next sync. Events created in Google
  stay separate. Previously imported personal events stay in Poli and their Google copies
  resume syncing when you select two-way again.
- **Two-way** lets you create, edit or delete personal events in either app. Changes made
  in Google to a class, exam or shared meeting appear on your own timetable. Edits to
  different fields are combined. If both apps edit the same field between syncs, Google wins.

New connections and connections using the original exporter start in one-way mode.
Accounts already using two-way sync keep it. The server checks about once a minute.
**Sync now** runs the selected direction immediately.

To check a deployment’s OAuth client against Google, set its client ID and secret and a
`GOOGLE_CALENDAR_TEST_REFRESH_TOKEN` from a consenting test account in the shell. Run
`npm test -- tests/google-live.test.ts`. It creates a temporary secondary calendar, exercises
both directions, and removes that test calendar on completion.

### Configuration

Registration and password resets share an e-mail sender. See `.env.example` for the available settings.

| Variable | Effect |
| --- | --- |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Connects the assistant to Gemini (default model `gemini-4-hydrogen`). Takes precedence over Claude. |
| `ANTHROPIC_API_KEY` | Connects the assistant to Claude instead. Without either key a built-in keyword assistant answers the common questions. |
| `RESEND_API_KEY`, `VERIFICATION_EMAIL_FROM` | Sends registration and password-reset links over HTTPS. Use a send-only key and a sender on its verified domain. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Sends calendar exports. Also sends account links when the Resend key is unset. |
| `APP_URL` | Public address for e-mailed links. Railway defaults to its assigned HTTPS domain. Other production hosts must set this explicitly for account links. |
| `CAMPUSPATH_URL`, `CAMPUSPATH_PORT`, `CAMPUSPATH_PYTHON` | Campus walkthroughs. By default the app starts `services/campuspath` itself on port 8765 with `services/campuspath/.venv`; set `CAMPUSPATH_URL` to use a service you run yourself. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google Calendar OAuth web client. Enable the Google Calendar API and register `<APP_URL>/api/google/callback` as an authorized redirect URI. |
| `GOOGLE_MAPS_EMBED_KEY` | A Maps Embed API key for the map on the Campus page. Without it the keyless Google Maps embed is used. |
| `TRUSTED_CLIENT_IP_HEADER` | Header your proxy overwrites with the visitor's address, used to limit sign-in attempts per client. On Railway `x-real-ip` is used automatically; without a trusted header all visitors share one counter. |
| `ADMIN_EMAILS` | Comma-separated addresses that become administrators when they register. |
| `DATABASE_PATH` | Where the SQLite file lives (default `data/upt.db`). |
| `TIMETABLE_PYTHON` | Python executable with pdfplumber installed. Defaults to the project's virtual environment, then to `python3`. |

**E-mail.** Any mailbox that allows SMTP works. With Gmail: turn on 2-Step
Verification, create an app password at <https://myaccount.google.com/apppasswords>,
then set `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_USER` to the address and
`SMTP_PASS` to the app password. Each account can send its calendar once a minute and
ask for three password links an hour.

**Registration.** A verification link works once, for one hour. Visiting the link opens the
account form. Submitting it creates the account and continues to onboarding or the original
event invitation. Students can request up to three links per hour, at least one minute apart.
Existing accounts continue using their current credentials.

**Passwords and sign-in.** "Forgot your password?" e-mails a link that works once, for
an hour. Only a hash of the link's token is stored. The form answers the same way, and
as quickly, for known and unknown addresses (the mail is sent after the response). A
successful reset signs the account out everywhere and replaces the private calendar
link. Sign-in allows five wrong passwords per address and thirty per client in fifteen
minutes; the counters live in the server process, so they reset when it restarts.

**The calendar link.** The `.ics` subscription link is a secret: anyone who has it can
read the timetable. Students can replace it under Settings → Calendar sync and export ("Get a new link");
the old one stops working at once.

## Languages

Every text of the interface lives in `src/i18n/messages/`, one file per area, with the
Romanian object typed against the English one, so a missing key fails the type check.
Server code reads `await getT()` (`src/i18n/server.ts`), client components `useT()`
(`src/i18n/client.tsx`). The language follows the visitor's choice (a cookie, and the
account once signed in), else the browser's preference, else Romanian. Dates, weekday
names, week rules and plurals go through helpers in `src/lib/time.ts` and
`src/i18n/config.ts`. Course names, room codes and people's names are data and are
never translated.

## The assistant

Poli runs on Gemini (`src/lib/assistant/gemini.ts`, the tool loop runs in this app) or,
when only an Anthropic key is set, on Claude Managed Agents
(`src/lib/assistant/claude.ts`). Both share the prompt in `src/lib/assistant/prompt.ts`
and the tools, which answer from the local database. Without a key, a keyword assistant
(`local.ts`) answers the common questions from the same tools.

| Tools | What they cover |
| --- | --- |
| `tools.ts` | The calendar: schedule, next event, exams, free time, meeting slots, directions across the city, hiding and moving classes, personal events, calendar by e-mail |
| `tools-study.ts` | Labs this week and week parity, make-up sessions, the exam study plan, attendance, the glossary, the semester calendar, the first-week checklist |
| `tools-people.ts` | Contacts of both kinds, who is free in a time slot, contact requests, group events and invitations |
| `tools-app.ts` | Campus walkthroughs, course and lab-slot choices, the student's group, the interface language, opening a page, the calendar link |

A few rules keep it safe. Nothing that reaches other people or replaces data happens on
the first call: creating a group event, removing a linked contact, changing the group
and saving a study plan all return a summary first and act only with `confirmed: true`,
after the student said yes. Adding or moving an event produces a day preview, and the
Accept button (`/api/assistant/accept`) applies the stored change directly, so what is
saved is exactly what was shown. A linked contact's calendar is shared the same way as
on their schedule page: classes and exams by name, everything else as busy time.

Under a reply the chat can show time-slot buttons (`show_choices`), a day preview, and
buttons that open a page of the app (a walkthrough, a group event). The assistant can
also switch the interface language and take the student to a page when asked.

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
src/lib/           schedule resolution, labs and make-up sessions, study plan, contacts,
                   exports, directions, auth and password reset, assistant
src/lib/campuspath/  client for the walkthrough service; starts it on demand
src/i18n/          languages: configuration and the message catalogue
src/app/           pages and API routes
services/campuspath/  the walkthrough service (Python): routing through the 360° tour,
                   classroom directory, directions in RO/EN, video rendering
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
- **Sign-in limits** are kept in memory. Several servers would need a shared store. Google
  refresh tokens are stored unencrypted in the database.
- **Walkthrough videos** are rendered on demand, one at a time, and cached on disk under
  `services/campuspath/.cache`. Rendering a new route downloads panoramas from
  visit360.upt.ro; the bundled example works offline.
- **Academic calendar.** Semester dates for 2026–2027 are seeded from Senate decision
  HS 26/19.03.2026; next year's need adding to `src/db/seed.ts` (or the `semesters`
  table) and selecting under Admin → Semester.
- **Time zone.** All times are Europe/Bucharest wall-clock, independent of the server's.
