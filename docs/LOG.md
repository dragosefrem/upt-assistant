# Jurnalul proiectului UPT Orar

Memoria proiectului: deciziile, ce a mers, ce nu și ce urmează. Se adaugă o intrare după fiecare sarcină terminată; intrările vechi nu se șterg.

## Rezumat până la 21 noiembrie 2026, 12:26
Gata (branch `Interface`, PR #1):
- Interfață prietenoasă cu mascota Poli: card de salut cu întrebări rapide, temă caldă, meniu cu iconițe, reparat scroll-ul orizontal pe telefon.
- Poli e butonul de chat: oricare Poli apeși sare, face ochi fericiți, scoate inimioare și deschide chatul (`Mascot.tsx`, `PoliChat.tsx`, `poliFx.ts`).
- Calendar interactiv: clic sau tragi pe grilă ca să adaugi un eveniment; „+” pe zi în vederea pe lună (`Calendar.tsx`, `PersonalEventDialog.tsx`).
- Examene și remindere: pagina Exams cu sală, clădire, hartă, sfaturile lui Poli și căutare; clopoțel cu notificări (o săptămână, o zi, 2 h, 30 min); alarme la examene în Google Calendar și `.ics` (`reminders.ts`, `examTips.ts`, `NotificationBell.tsx`, `export.ts`, `google.ts`).
- Demo interactiv în `docs/demo/`, publicat la https://claude.ai/artifact/1rzWqtq5c7nfpsQg1vaN89 (public).
- Prompturi pentru imaginile lui Poli (ChatGPT/Gemini) în `docs/IMAGINI.md`.

Decis:
- Pagina Calendar rămâne cum era (fără card de examene); examenele stau pe pagina Exams, cu sfaturi și căutare (cerut de echipă).
- Notificările pe dispozitiv merg doar cu aplicația deschisă; pentru telefon cu aplicația închisă folosim alarmele din Google Calendar/.ics, ca să nu avem nevoie de server de push.
- Interfața aplicației rămâne în engleză deocamdată; landing page-ul e în română.

Nu a mers:
- Turbopack nu acceptă `node_modules` legat simbolic din alt dosar; aplicația se rulează dintr-o copie cu pachetele instalate.
- `npm ci` eșuează: `package-lock.json` nu se potrivește cu `package.json` (problemă veche, se rezolvă cu `npm install` + commit).

## 21 nov 2026, 15:40
Gata: landing page în română la `/welcome` (`src/app/welcome/page.tsx`, `src/lib/landing.ts`, `src/lib/landing-format.ts`); vizitatorii nelogați și cei care ies din cont ajung acolo; link „← What is UPT Orar?” pe ecranul de login. Cifrele (ore din semestrul curent, examene, facultăți) vin din baza de date. Criterii în `docs/CRITERIA.md`, review în `docs/REVIEW.md`. Jurnalul proiectului pornit (`docs/LOG.md`, regulile în `CLAUDE.md`, hook-ul în `.claude/settings.json`).
Decis: direcția „prietenoasă cu Poli, în română” din `UPT_Orar_Landing_Pages.pdf`, în aplicație, nu ca pagină separată (ales de echipă). Nicio cifră scrisă de mână.
Nu a mers: PDF-ul promite butonul Accept cu previzualizare, mutare pentru o singură săptămână, calendar pe email și detectarea automată a limbii; în cod nu există, așa că le-am scos de pe pagină după prima rundă de review.
Următorul pas: traducerea interfeței aplicației în română; un semn de derulare pentru orarul exemplu pe telefon; decizia echipei despre fișierele urcate în rădăcina repo-ului (`desk.png`, `mob.png`, `.zip`, `.patch`).
