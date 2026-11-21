// Interface text in English and Romanian. Directions and notices arrive translated from the API.
const counted = {
  en: (n, one, many) => n + " " + (n === 1 ? one : many),
  // Romanian adds "de" from 20 up, except where the last two digits are 01 to 19.
  ro: (n, one, many) => n + " " + (n === 1 ? one : n === 0 || (n % 100 > 0 && n % 100 < 20) ? many : "de " + many),
};
const floors = { Parter: "Ground floor", Mezanin: "Mezzanine", Demisol: "Basement", Mansardă: "Attic", Etaj: "Upper floor" };

const TEXT = {
  en: {
    title: "Campuspath · UPT route planner",
    home: "Campuspath home",
    language: "Language",
    openTour: "Open UPT 360°",
    headline: "Find your room",
    lead: "Turn a campus route into a video you can follow, checkpoint by checkpoint.",
    plan: "Plan your route",
    start: "Starting checkpoint",
    locate: "Locate me",
    chooseStart: "Choose a checkpoint",
    where: "Where do you want to go?",
    browse: "Browse classrooms",
    prompt: "I want to go to sala B419",
    examplePrompt: "From the AC entrance to B419",
    tryExample: (prompt) => "Try “" + prompt + "”",
    generate: "Generate walkthrough",
    routeVideo: "Route video",
    videoLabel: "Checkpoint walkthrough",
    kindExample: "Example walkthrough",
    kindPartial: "Partial walkthrough",
    endsAt: (place) => "Video ends at: " + place,
    kindYours: "Your walkthrough",
    loading: "Loading walkthrough…",
    play: "Play walkthrough",
    retry: "Try again",
    noCount: "— checkpoints",
    checkpoints: (n) => counted.en(n, "checkpoint", "checkpoints"),
    guide: "Checkpoint guide",
    credit: "Panoramas and navigation links from the UPT virtual tour.",
    pickStart: "Choose a starting checkpoint",
    pickDestination: "Choose a destination",
    directory: "Classroom directory",
    close: "Close",
    searchCheckpoints: "Search checkpoints",
    searchRooms: "Search classrooms",
    searchStartHint: "Place, room code or UPT tour link",
    searchRoomHint: "Room code, name, faculty or building",
    nearbyButton: "Find a nearby building",
    previous: "Previous",
    next: "Next",
    previousStep: "Previous step",
    nextStep: "Next step",
    stepOf: (step, total) => "Step " + step + " of " + total,
    stepHint: "Go one checkpoint at a time",
    copyLink: "Copy link",
    linkCopied: "Link copied",
    qrCode: "QR code",
    shareTitle: "Share this route",
    qrAlt: "QR code that opens this route",
    qrHint: "Scan the code with a phone camera to open this route.",
    qrLocal: "This address only opens on this computer, so the code will not work on a phone.",
    qrFailed: "The code could not be made. The link below still works.",
    saveImage: "Save image",
    failed: "Request failed.",
    checkpoint: (index) => "Checkpoint " + index,
    noPlayback: "Playback could not start. Open the MP4 to watch the walkthrough.",
    playFrom: (time) => "Play from " + time,
    playStep: (number, name, time) => "Play checkpoint " + number + ", " + name + ", at " + time,
    openView: "Open this view in the UPT tour",
    openNamed: (name) => "Open " + name + " in the UPT tour",
    queued: "Walkthrough queued…",
    rendering: (current, total) => "Rendering checkpoint " + current + " of " + total + "…",
    interrupted: "The connection to the route planner was interrupted.",
    ground: "Ground floor",
    floor: (number) => "Floor " + number,
    level: (text) => floors[text] || text.replace(/^Etaj(?:ul)? (\d+)$/, "Floor $1"),
    walkthrough: (title) => "Walkthrough: " + title,
    reachRoom: "Video to the room",
    reachDoor: "Video to the door",
    reachFloor: "Video to its floor",
    reachNear: "Video to a nearby floor",
    reachCheckpoint: "Video to a nearby checkpoint",
    reachEntrance: "Video to the building entrance",
    reachNone: "No video yet",
    sources: (n) => "Room sources (" + n + ")",
    toPin: (distance) => distance + " to building pin",
    roomsFound: (n) => counted.en(n, "classroom", "classrooms") + " matching your search.",
    roomsListed: (n) => counted.en(n, "classroom", "classrooms") + " in the directory.",
    range: (first, last, total) => first + "–" + last + " of " + total,
    noMatch: "No matching checkpoint. Try a room code, building name or numbered tour link.",
    chooseMeant: "Choose the place you mean.",
    selectView: "Select a view you recognize. You can also paste a shared tour link.",
    searchDown: "Search is unavailable. Try again.",
    loadingCheckpoints: "Loading checkpoints…",
    lookingNearby: "Looking for nearby campus buildings…",
    closest: (distance) => "The closest mapped building is " + distance + " away.",
    accuracy: (distance) => "Location accuracy is about " + distance + ".",
    confirmView: "Confirm a building view below, or search for your indoor checkpoint.",
    declined: "Location access was declined.",
    noLocation: "Location is unavailable.",
    chooseBelow: "Choose your starting checkpoint below.",
    exampleMissing: "Example unavailable",
    exampleFailed: "The example could not be loaded. You can still request a route.",
  },
  ro: {
    title: "Campuspath · Planificator de trasee UPT",
    home: "Campuspath, pagina principală",
    language: "Limbă",
    openTour: "Deschide UPT 360°",
    headline: "Găsește-ți sala",
    lead: "Transformă un traseu prin campus într-un videoclip pe care îl urmezi punct cu punct.",
    plan: "Planifică traseul",
    start: "Punct de plecare",
    locate: "Localizează-mă",
    chooseStart: "Alege un punct",
    where: "Unde vrei să ajungi?",
    browse: "Vezi sălile",
    prompt: "Vreau să ajung la sala B419",
    examplePrompt: "De la intrarea AC la B419",
    tryExample: (prompt) => "Încearcă „" + prompt + "”",
    generate: "Generează traseul video",
    routeVideo: "Videoclipul traseului",
    videoLabel: "Traseu video pe puncte",
    kindExample: "Traseu video exemplu",
    kindPartial: "Traseu video parțial",
    endsAt: (place) => "Videoclipul se termină la: " + place,
    kindYours: "Traseul tău video",
    loading: "Se încarcă traseul video…",
    play: "Redă traseul video",
    retry: "Încearcă din nou",
    noCount: "— puncte",
    checkpoints: (n) => counted.ro(n, "punct", "puncte"),
    guide: "Ghid pe puncte",
    credit: "Panorame și legături de navigare din turul virtual UPT.",
    pickStart: "Alege punctul de plecare",
    pickDestination: "Alege destinația",
    directory: "Lista sălilor",
    close: "Închide",
    searchCheckpoints: "Caută puncte",
    searchRooms: "Caută săli",
    searchStartHint: "Loc, cod de sală sau link din turul UPT",
    searchRoomHint: "Cod de sală, nume, facultate sau clădire",
    nearbyButton: "Găsește o clădire din apropiere",
    previous: "Înapoi",
    next: "Înainte",
    previousStep: "Pasul anterior",
    nextStep: "Pasul următor",
    stepOf: (step, total) => "Pasul " + step + " din " + total,
    stepHint: "Mergi punct cu punct",
    copyLink: "Copiază linkul",
    linkCopied: "Link copiat",
    qrCode: "Cod QR",
    shareTitle: "Distribuie traseul",
    qrAlt: "Cod QR care deschide acest traseu",
    qrHint: "Scanează codul cu camera telefonului ca să deschizi traseul.",
    qrLocal: "Adresa aceasta se deschide doar pe acest calculator, deci codul nu va merge pe telefon.",
    qrFailed: "Codul nu a putut fi generat. Linkul de mai jos funcționează în continuare.",
    saveImage: "Salvează imaginea",
    failed: "Cererea nu a reușit.",
    checkpoint: (index) => "Punctul " + index,
    noPlayback: "Redarea nu a putut porni. Deschide fișierul MP4 ca să vezi traseul.",
    playFrom: (time) => "Redă de la " + time,
    playStep: (number, name, time) => "Redă punctul " + number + ", " + name + ", de la " + time,
    openView: "Deschide această imagine în turul UPT",
    openNamed: (name) => "Deschide " + name + " în turul UPT",
    queued: "Traseul video așteaptă la rând…",
    rendering: (current, total) => "Se generează punctul " + current + " din " + total + "…",
    interrupted: "Conexiunea cu planificatorul de trasee s-a întrerupt.",
    ground: "Parter",
    floor: (number) => "Etaj " + number,
    level: (text) => text,
    walkthrough: (title) => "Traseu video: " + title,
    reachRoom: "Video până în sală",
    reachDoor: "Video până la ușă",
    reachFloor: "Video până la etajul sălii",
    reachNear: "Video până la un etaj apropiat",
    reachCheckpoint: "Video până la un punct apropiat",
    reachEntrance: "Video până la intrarea clădirii",
    reachNone: "Încă fără video",
    sources: (n) => "Surse pentru sală (" + n + ")",
    toPin: (distance) => distance + " până la reperul clădirii",
    roomsFound: (n) => counted.ro(n, "sală găsită", "săli găsite") + ".",
    roomsListed: (n) => counted.ro(n, "sală", "săli") + " în listă.",
    range: (first, last, total) => first + "–" + last + " din " + total,
    noMatch: "Niciun punct găsit. Încearcă un cod de sală, numele unei clădiri sau un link numerotat din tur.",
    chooseMeant: "Alege locul la care te referi.",
    selectView: "Alege o imagine pe care o recunoști. Poți lipi și un link distribuit din tur.",
    searchDown: "Căutarea nu este disponibilă. Încearcă din nou.",
    loadingCheckpoints: "Se încarcă punctele…",
    lookingNearby: "Se caută clădiri din campus în apropiere…",
    closest: (distance) => "Cea mai apropiată clădire de pe hartă este la " + distance + ".",
    accuracy: (distance) => "Precizia localizării este de aproximativ " + distance + ".",
    confirmView: "Confirmă mai jos imaginea unei clădiri sau caută punctul tău din interior.",
    declined: "Accesul la locație a fost refuzat.",
    noLocation: "Locația nu este disponibilă.",
    chooseBelow: "Alege mai jos punctul de plecare.",
    exampleMissing: "Exemplu indisponibil",
    exampleFailed: "Exemplul nu a putut fi încărcat. Poți cere totuși un traseu.",
  },
};

function remembered() {
  try {
    return localStorage.getItem("campuspath.lang");
  } catch {
    return null;
  }
}
// The student's own choice wins. Otherwise Romanian is used when the browser prefers it to English.
function preferred() {
  const wanted = (navigator.languages?.length ? navigator.languages : [navigator.language || "en"]).map((tag) =>
    tag.toLowerCase().split("-")[0],
  );
  return wanted.find((tag) => tag in TEXT) || "en";
}

// A link can ask for a language with ?lang=ro. It applies to this visit and is not stored.
const asked = new URLSearchParams(location.search).get("lang");
export let lang = asked in TEXT ? asked : remembered() in TEXT ? remembered() : preferred();

export function t(key, ...values) {
  const entry = TEXT[lang][key];
  return typeof entry === "function" ? entry(...values) : entry;
}
export function isDefault(key, value) {
  return Object.values(TEXT).some((text) => text[key] === value);
}

const targets = {
  i18n: "textContent",
  i18nLabel: "aria-label",
  i18nHint: "placeholder",
  i18nTitle: "title",
  i18nAlt: "alt",
};
export function translatePage() {
  document.documentElement.lang = lang;
  document.title = t("title");
  for (const node of document.querySelectorAll(
    "[data-i18n],[data-i18n-label],[data-i18n-hint],[data-i18n-title],[data-i18n-alt]",
  )) {
    for (const [name, target] of Object.entries(targets)) {
      if (!(name in node.dataset)) continue;
      if (target === "textContent") node.textContent = t(node.dataset[name]);
      else node.setAttribute(target, t(node.dataset[name]));
    }
  }
  for (const button of document.querySelectorAll("[data-lang]")) {
    button.setAttribute("aria-pressed", String(button.dataset.lang === lang));
  }
}
export function setLanguage(next) {
  if (!(next in TEXT) || next === lang) return false;
  lang = next;
  try {
    localStorage.setItem("campuspath.lang", next);
  } catch {
    // The choice still holds for this visit.
  }
  translatePage();
  return true;
}
