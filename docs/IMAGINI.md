# Imagini pentru UPT Orar: prompturi pentru ChatGPT și Gemini

Interfața folosește acum o mascotă, **Poli**, un roboțel prietenos în albastrul UPT.
Fișierul `public/images/mascot.svg` e doar o variantă provizorie desenată de mână.
Generezi imaginile finale cu ChatGPT (generare de imagini) sau Gemini, apoi le pui în proiect.

Prompturile sunt în engleză, pentru că ambele modele dau rezultate mai bune așa.

## Reguli comune (adaugă-le la fiecare prompt dacă rezultatul iese inconsecvent)

- Paletă: albastru `#2f5fe0` / `#1f48c4`, bleu foarte deschis `#eef4ff`, accent galben `#fbbf24`, obraji roz.
- Fundal **transparent** (PNG), fără text în imagine, în afară de eticheta „UPT” de pe mascotă.
- Același personaj în toate imaginile: după ce ai o mascotă care îți place, încarc-o ca referință
  în conversație și cere „same character, same style”.

## 1. Mascota principală (cea mai importantă)

Fișier: `public/images/mascot.png` · 512×512 · fundal transparent

```
A cute, friendly robot mascot for a university student app, flat vector illustration,
soft rounded shapes. Round-cornered blue head (#2f5fe0) with a pale blue face screen
(#eef4ff), two big dark friendly eyes with white highlights, a small happy smile,
pink blush cheeks, a short antenna with a yellow (#fbbf24) ball on top, small rounded
ear-pieces on the sides. A small blue badge under the head with the letters "UPT".
Front view, centered, simple and readable at 32 px, no outlines thicker than needed,
no gradients or only very subtle ones, transparent background, no other text.
```

## 1b. Poli fericit (pentru animația de la apăsare)

Fișier: `public/images/mascot-happy.png` · 512×512 · fundal transparent

Când apeși pe Poli, el sare și apare fața lui fericită. Același personaj, încarcă mascota
de la pasul 1 ca referință:

```
Same character and style as the reference image, exact same pose and size, but with
happy closed eyes drawn as two upward arcs (^ ^), a bigger smile, and the antenna ball
pink (#f472b6) instead of yellow. Transparent background, no other changes.
```

## 2. Mascota în alte poze (opțional)

Același personaj, încarcă mascota de la pasul 1 ca referință. 512×512, transparent.

| Fișier | Prompt (după „Same character and style as the reference image,”) |
| --- | --- |
| `mascot-wave.png` | `waving hello with one small hand, cheerful expression.` |
| `mascot-thinking.png` | `thinking pose, looking up, a small yellow question mark above the antenna.` |
| `mascot-calendar.png` | `holding a small blue calendar page, proud smile.` |
| `mascot-sleep.png` | `sleeping peacefully with closed eyes and a small "z z", for an empty day.` |

## 3. Ilustrație pentru ecranul de login (opțional)

Fișier: `public/images/login-hero.png` · 1200×800

```
Soft flat illustration of a friendly university campus scene in Timișoara style,
modern engineering buildings, a few students walking with backpacks, trees, light
morning sky. Pastel palette based on blue (#2f5fe0, #eef4ff) with warm yellow accents
(#fbbf24). Minimal detail, lots of empty space, calm and welcoming, no text, no logos.
```

## Cum le pui în aplicație

1. Salvează mascota ca `public/images/mascot.png` și fața fericită ca `public/images/mascot-happy.png`.
2. În `src/components/Mascot.tsx` schimbă `MASCOT_SRC` în `"/images/mascot.png"` și
   `MASCOT_HAPPY_SRC` în `"/images/mascot-happy.png"`.
   Atât: mascota apare peste tot (antet, salut, chat, examene, notificări, login).
   Butonul mare din colț (`src/components/PoliChat.tsx`) e desenat direct în cod, ca să-și
   poată schimba ochii; dacă vrei și acolo imaginea nouă, spune-mi și îl trec pe imagini.
3. Pentru celelalte poze, trimite-mi fișierele și le leg eu în locurile potrivite
   (de ex. `mascot-sleep` când nu ai ore, `mascot-thinking` cât timp răspunde asistentul).

> Notă: nu folosi logo-ul oficial UPT în imaginile generate fără acordul universității.
