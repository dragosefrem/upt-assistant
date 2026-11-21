# Review: landing page (`/welcome`)

Făcut cu skill-ul jury-review: criteriile din `docs/CRITERIA.md`, trei runde cu evaluatori independenți (fără istoricul conversației), care au rulat aplicația în browser, au interogat baza de date și au citit codul. După fiecare rundă am reparat ce a picat.

## Rezultat final

| Criteriu | Verdict | Dovadă | Ce s-a reparat |
| --- | --- | --- | --- |
| 1. Nelogat pe `/` → `/welcome`; logat pe `/welcome` → `/` | PASS | Playwright, ambele cazuri; `src/lib/auth.ts`, `src/app/welcome/page.tsx` | — |
| 2. „Creează-ți contul” vizibil fără scroll, plus intrare în cont | PASS | Telefon 390×844 și laptop 1440×900: butoanele sunt în primul ecran și duc la `/register` și `/login` | Runda 1: „Intră în cont” lipsea pe telefon; acum e „Intră” |
| 3. Cifrele și facultățile vin din baza de date și nu promit mai mult decât există | PASS (verificat după runda 3) | Cu date de test: MEC apare la „Doar examene importate”, CT (are documente găsite) la „Linkuri către documente”, FIH (nimic) la „Încă fără orar”; cifrele sunt doar pentru semestrul curent și au forma corectă în română („1 oră”, „20 de ore”) | Runda 2: o facultate doar cu examene apărea la „Orar importat”. Runda 3: facultățile fără documente apăreau cu „linkuri”, iar numerele nu aveau forma corectă |
| 4. Fără text în afara ecranului pe telefon | PASS | `scrollWidth` 390 = lățimea ecranului; niciun text tăiat | Înainte de review: textul din partea de sus ieșea din ecran |
| 5. Meniul duce la secțiuni | PASS | Cele 4 linkuri duc la `#ce-face`, `#examene`, `#facultati`, `#intrebari` | — |
| 6. Română corectă, fără funcții care nu există | PASS | Fiecare afirmație verificată în cod (exportul `.ics` cu alarme, clopoțelul, căutarea, clic și tragere în calendar, vocea RO/EN etc.) | Runda 1: scoase butonul Accept cu previzualizare, mutarea pentru o singură săptămână, calendarul pe email și detectarea automată a limbii, care nu există în cod |
| B1. Pornește doar cu pașii din README | PASS | Pașii sunt coerenți; README spune că cifrele apar după primul import | — |
| B2. Fără secrete în repo | PASS | `git ls-files`: doar `.env.example`, cu valori goale | — |
| B3. Fără erori în consolă | PASS | Telefon și laptop: nicio eroare | — |

## Cele mai importante 3 lucruri rămase

1. **Limba.** Landing page-ul e în română, dar ecranele de cont și aplicația sunt în engleză. Traducerea interfeței ar face drumul de la „Creează-ți contul” coerent.
2. **Poli fără cheia de AI.** „Ascunde cursul de la ora 8” și „Mută laboratorul…” cer ca asistentul să fie configurat (cheia Anthropic). Fără ea, asistentul simplu răspunde doar la o parte din întrebări.
3. **Orarul exemplu pe telefon.** Se derulează lateral în cardul lui, fără un semn că se poate derula.

## Întrebări pe care le-ar pune juriul

1. Ce vede un student de la Mecanică după ce își face cont, dacă orarul facultății e doar în PDF?
2. Fără cheia de AI, la care dintre întrebările de pe pagină răspunde Poli?
3. Cine reîncarcă orarele de pe site-urile facultăților și cât de des?
