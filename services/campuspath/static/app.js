import { isDefault, lang, setLanguage, t, translatePage } from "./i18n.js";

const $ = (id) => document.getElementById(id);
const video = $("video");
const picker = $("picker");
const share = $("share");
const clock = (seconds) => {
  const whole = Math.floor(seconds);
  return Math.floor(whole / 60) + ":" + String(whole % 60).padStart(2, "0");
};
const icon = (name) => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const use = document.createElementNS(svg.namespaceURI, "use");
  use.setAttribute("href", "/static/icons.svg#" + name);
  svg.setAttribute("aria-hidden", "true");
  svg.append(use);
  return svg;
};
function element(tag, className, text) {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}
function thumbnail(record, style) {
  const wrap = element("span", style);
  if (!record.thumb) {
    wrap.append(icon("pin"));
    return wrap;
  }
  const image = new Image();
  image.alt = "";
  image.loading = "lazy";
  image.src = record.thumb;
  image.addEventListener("error", () => image.remove(), { once: true });
  wrap.append(image);
  return wrap;
}
async function api(url, options) {
  const response = await fetch(url, options);
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.message || t("failed")), result);
  return result;
}
function message(text = "") {
  $("form-message").textContent = text;
  $("form-message").hidden = !text;
}

let origin = null;
let chosenDestination = null;
let route = null;
let activeStep = -1;
let generation = 0;
let viewToken = 0;
let pollTimer;
let pickerToken = 0;
let searchTimer;
let pickField = "start";
let pickOptions = null;
let pageOffset = 0;
const pageSize = 35;
let submitAfterPick = false;
let retryRequest = null;
let exampleFailed = false;
// Step-by-step playback stops at the end of each checkpoint, so a walker can catch up.
let stepping = false;
let stepStop = 0;
// A link names a route as ?from=355&to=B527. "from" is a checkpoint number or a place name.
const link = new URLSearchParams(location.search);
let linkOrigin = null;

const loadExample = () => api("/api/example?" + new URLSearchParams({ lang }));

function setOrigin(record) {
  origin = record;
  linkOrigin = null;
  $("start-name").textContent = record.name;
  $("choose-start").classList.add("has-value");
  $("choose-start").title =
    record.area + " · " + (record.coverage ? coverageLabel(record) : t("checkpoint", record.index));
}
function highlight(index) {
  if (index === activeStep) return;
  const rows = $("steps").children;
  if (rows[activeStep]) {
    rows[activeStep].classList.remove("current");
    rows[activeStep].removeAttribute("aria-current");
  }
  if (rows[index]) {
    rows[index].classList.add("current");
    rows[index].setAttribute("aria-current", "step");
  }
  activeStep = index;
  showNow();
}
const started = () => $("screen-overlay").hidden;
// The step in view as text: the caption burned into the video is too small to read on a phone.
function showNow() {
  const step = route?.steps[activeStep];
  const walking = Boolean(step) && started();
  $("now-count").textContent = walking ? t("stepOf", activeStep + 1, route.steps.length) : t("stepHint");
  $("now-name").textContent = walking ? step.name : "";
  $("now-note").textContent = walking ? step.instruction : "";
  $("step-back").disabled = !walking || activeStep === 0;
  $("step-next").disabled = walking && activeStep === route.steps.length - 1;
}
async function playFrom(time, stop) {
  if (route?.video?.state !== "ready") return;
  stepping = stop !== undefined;
  stepStop = stop;
  try {
    if (time !== undefined) video.currentTime = time;
    await video.play();
    $("screen").classList.add("watch");
    $("screen-overlay").hidden = true;
    video.controls = !stepping;
    showNow();
    if (stepping) requestAnimationFrame(holdStep);
  } catch {
    message(t("noPlayback"));
  }
}
function holdStep() {
  if (!stepping || video.paused) return;
  if (video.currentTime < stepStop) return void requestAnimationFrame(holdStep);
  video.pause();
  video.currentTime = stepStop;
}
function playStep(index) {
  const steps = route.steps;
  if (index < 0 || index >= steps.length) return;
  // Stop on the last frame of this checkpoint, with its marker in place.
  const end = index + 1 < steps.length ? steps[index + 1].time : route.duration;
  highlight(index);
  playFrom(steps[index].time, end - 0.06);
}
$("step-next").addEventListener("click", () => playStep(started() ? activeStep + 1 : 0));
$("step-back").addEventListener("click", () => playStep(activeStep - 1));
document.addEventListener("keydown", (event) => {
  if (document.querySelector("dialog[open]") || $("stepper").hidden || event.target === video) return;
  if (event.target.closest?.("input, textarea, select") || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.key === "ArrowRight") $("step-next").click();
  if (event.key === "ArrowLeft") $("step-back").click();
});
function showSteps() {
  const list = $("steps");
  list.replaceChildren();
  list.classList.toggle("still", !route.video);
  activeStep = -1;
  for (const [index, step] of route.steps.entries()) {
    const row = element("li", "step");
    const jump = element("button", "step-main");
    jump.type = "button";
    if (route.video) {
      jump.title = t("playFrom", clock(step.time));
      jump.setAttribute("aria-label", t("playStep", index + 1, step.name, clock(step.time)));
    }
    jump.disabled = route.video?.state !== "ready";
    jump.addEventListener("click", () => {
      $("screen").scrollIntoView({ block: "nearest" });
      playFrom(step.time);
    });
    const text = element("span", "step-info");
    text.append(element("span", "step-title", step.name), element("span", "step-note", step.instruction));
    jump.append(
      element("span", "step-number", index + 1),
      thumbnail(step, "step-thumb"),
      text,
      element("span", "time", route.video ? clock(step.time) : ""),
    );
    const link = element("a", "step-link");
    link.href = step.url;
    link.target = "_blank";
    link.rel = "noopener";
    link.title = t("openView");
    link.setAttribute("aria-label", t("openNamed", step.name));
    link.append(icon("external"));
    row.append(jump, link);
    list.append(row);
  }
  highlight(0);
}
video.addEventListener("timeupdate", () => {
  if (!route || !Number.isFinite(video.currentTime)) return;
  let index = 0;
  while (index + 1 < route.steps.length && route.steps[index + 1].time <= video.currentTime) index++;
  highlight(index);
});
video.addEventListener("ended", () => {
  video.controls = false;
  $("screen-overlay").hidden = false;
  $("screen").classList.remove("watch");
  showNow();
});
$("play").addEventListener("click", () => playFrom(video.ended ? 0 : undefined));

function renderLabel(state) {
  if (state.state === "error") return state.message;
  if (state.state === "queued") return t("queued");
  return t("rendering", Math.min(state.completed + 1, state.total), state.total);
}
function mediaState(state, token) {
  if (token !== viewToken) return;
  route.video = state;
  const ready = state.state === "ready";
  $("play").disabled = !ready;
  $("download").hidden = !ready;
  $("stepper").hidden = !ready;
  $("render-state").hidden = ready;
  $("retry").hidden = state.state !== "error";
  $("render-progress").hidden = state.state === "error";
  if (ready) {
    video.poster = state.poster;
    video.src = state.url;
    $("download").href = state.url;
    $("download").download = "Campuspath - " + goal() + ".mp4";
    for (const button of document.querySelectorAll(".step-main")) button.disabled = false;
    return;
  }
  $("render-label").textContent = renderLabel(state);
  if (state.state === "error") return;
  $("render-progress").max = state.total;
  $("render-progress").value = state.completed;
  pollTimer = window.setTimeout(async () => {
    try {
      const next = await api("/api/videos/" + state.key);
      mediaState(next, token);
    } catch {
      mediaState({ state: "error", message: t("interrupted") }, token);
    }
  }, 950);
}
// The place the student asked for. A video that stops short of a room is still a route to that room.
function goal() {
  const room = route.destination;
  return room ? room.code || room.label : route.steps.at(-1).name;
}
// Every label that is worked out from the route in view, in the current language.
function labelRoute() {
  const first = route.steps[0];
  const last = route.steps.at(-1);
  const room = route.destination;
  const title = route.steps.length === 1 ? last.name : first.name + " → " + goal();
  $("guide-range").textContent = title;
  $("share-route").textContent = title;
  if (!route.video) return;
  const partial = route.coverage === "checkpoint";
  $("route-title").textContent = title;
  $("preview-area").textContent = partial ? t("endsAt", last.name) : last.area;
  $("video-kind").textContent =
    retryRequest === loadExample ? t("kindExample") : partial ? t("kindPartial") : t("kindYours");
  $("duration").textContent = clock(route.duration);
  $("count").textContent = t("checkpoints", route.steps.length);
  // The room's own floor, which can differ from the floor where a partial video ends.
  const level = room?.level
    ? t("level", room.level)
    : !Number.isInteger(last.floor) || last.floor < 0
      ? ""
      : last.floor === 0
        ? t("ground")
        : t("floor", last.floor);
  $("floor-fact").hidden = !level;
  $("floor").textContent = level;
  video.setAttribute("aria-label", t("walkthrough", title));
}
function showRoute(result, retry) {
  clearTimeout(pollTimer);
  const token = ++viewToken;
  video.pause();
  video.removeAttribute("src");
  video.removeAttribute("poster");
  video.load();
  video.controls = false;
  $("screen").classList.remove("watch");
  $("screen-overlay").hidden = false;
  stepping = false;
  $("stepper").hidden = true;
  route = result;
  retryRequest = retry;
  shareRoute();
  // A single checkpoint has no walk to film: the planner sends its notice and view without a video.
  const hasVideo = Boolean(result.video);
  document.querySelector(".preview").hidden = !hasVideo;
  document.querySelector(".guide").hidden = !result.steps.length;
  showRoomDetails(result);
  if (!result.steps.length) return;
  labelRoute();
  showSteps();
  if (hasVideo) mediaState(route.video, token);
}

// How near the tour gets to a classroom, in the student's terms.
// Keep the address bar on the route in view, so that it can be copied, bookmarked or put in a timetable.
function shareRoute() {
  const params = new URLSearchParams();
  if (retryRequest !== loadExample) {
    const room = route.destination;
    if (route.steps.length) params.set("from", route.steps[0].index);
    params.set("to", room ? room.code || room.label : "#" + route.steps.at(-1).index);
    if (room) params.set("dest", room.index);
  }
  const query = params.toString();
  history.replaceState(null, "", location.pathname + (query ? "?" + query : ""));
}
const routeLink = () => location.origin + location.pathname + location.search;
async function copyLink(button) {
  try {
    await navigator.clipboard.writeText(routeLink());
    button.textContent = t("linkCopied");
    setTimeout(() => (button.textContent = t("copyLink")), 1800);
  } catch {
    // No clipboard here: leave the address where it can be copied by hand.
    if (share.open) getSelection().selectAllChildren($("share-link"));
    else message(routeLink());
  }
}
$("copy-link").addEventListener("click", () => copyLink($("copy-link")));
$("copy-shared").addEventListener("click", () => copyLink($("copy-shared")));

// The same address as a QR code: for a phone to pick up from this screen, or to print beside a timetable.
const qrPicture = (format) => "/api/qr?" + new URLSearchParams({ link: routeLink(), format });
function showQr() {
  const name = goal()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 40)
    .replace(/^-|-$/g, "");
  $("qr-image").hidden = false;
  $("qr-image").src = qrPicture("svg");
  $("qr-note").textContent = t("qrHint");
  // A code for an address on this computer is of no use to the phone that scans it.
  $("qr-local").hidden = !/^(localhost|.+\.localhost|127(\.\d+){3}|\[::1\])$/.test(location.hostname);
  $("share-link").textContent = routeLink();
  $("save-qr").hidden = false;
  $("save-qr").href = qrPicture("png");
  $("save-qr").download = ["campuspath", name].filter(Boolean).join("-") + ".png";
  if (!share.open) share.showModal();
}
$("qr-image").addEventListener("error", () => {
  for (const id of ["qr-image", "qr-local", "save-qr"]) $(id).hidden = true;
  $("qr-note").textContent = t("qrFailed");
});
$("show-qr").addEventListener("click", showQr);
$("close-share").addEventListener("click", () => share.close());

function coverageLabel(item) {
  return {
    room: t("reachRoom"),
    door: t("reachDoor"),
    floor: t("reachFloor"),
    near: t("reachNear"),
    checkpoint: t("reachCheckpoint"),
    entrance: t("reachEntrance"),
    none: t("reachNone"),
  }[item.reach];
}
function roomFacts(room) {
  return [room.area, room.level && t("level", room.level), coverageLabel(room)].filter(Boolean);
}
function showRoomDetails(result) {
  const box = $("room-details");
  const room = result.destination;
  box.hidden = !room && !result.notice;
  box.replaceChildren();
  if (room) {
    box.append(element("h2", "", room.name));
    box.append(element("p", "", roomFacts(room).join(" · ")));
  }
  if (result.notice) box.append(element("strong", "", result.notice));
  if (room?.sources?.length) {
    const details = element("details", "room-sources");
    details.append(element("summary", "", t("sources", room.sources.length)));
    const list = element("ul", "");
    for (const source of room.sources) {
      const link = element(source.url ? "a" : "span", "", source.title);
      if (source.url) {
        link.href = source.url;
        link.target = "_blank";
        link.rel = "noopener";
      }
      const item = element("li", "");
      item.append(link);
      list.append(item);
    }
    details.append(list);
    box.append(details);
  }
}

async function generate() {
  const token = ++generation;
  message();
  const body = {
    prompt: $("prompt").value,
    start: origin?.index,
    destination: chosenDestination?.index,
    from: origin ? undefined : (linkOrigin ?? undefined),
  };
  $("generate").disabled = true;
  // The request is sent again in the other language when the student switches.
  const run = () =>
    api("/api/routes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, lang }),
    });
  const shown = retryRequest;
  retryRequest = run;
  try {
    const result = await run();
    if (token !== generation) return;
    if (result.steps.length) setOrigin(result.origin || result.steps[0]);
    showRoute(result, run);
  } catch (e) {
    if (retryRequest === run) retryRequest = shown;
    if (token !== generation) return;
    message(e.message);
    if (e.needsChoice) {
      openPicker(e.field, e.options?.length ? e.options : null, true);
    } else if (e.field === "destination") {
      $("prompt").focus();
    }
  } finally {
    if (token === generation) $("generate").disabled = false;
  }
}
$("route-form").addEventListener("submit", (e) => {
  e.preventDefault();
  generate();
});
$("prompt").addEventListener("input", () => {
  chosenDestination = null;
  message();
});
$("example-prompt").addEventListener("click", () => {
  $("prompt").value = t("examplePrompt");
  chosenDestination = null;
  message();
  $("prompt").focus();
});
// Ask again for the route in view: after a failed render, or in the language just chosen.
async function rerun(report) {
  if (!retryRequest) return;
  const token = ++generation;
  const retry = retryRequest;
  try {
    const result = await retry();
    if (token === generation) showRoute(result, retry);
  } catch (e) {
    if (token === generation) report(e.message);
  } finally {
    if (token === generation) $("generate").disabled = false;
  }
}
$("retry").addEventListener("click", async () => {
  $("retry").disabled = true;
  await rerun((text) => ($("render-label").textContent = text));
  $("retry").disabled = false;
});

const folded = (value) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
function showChoices(records) {
  $("choices").replaceChildren();
  for (const item of records) {
    const button = element("button", "choice");
    button.type = "button";
    const label = element("span", "choice-name");
    label.append(element("strong", "", item.name));
    const info = item.coverage ? roomFacts(item) : [item.area, "#" + item.index];
    if (item.distance !== undefined) info.push(t("toPin", distanceLabel(item.distance)));
    label.append(element("small", "", info.join(" · ")));
    button.append(thumbnail(item, "choice-image"), label);
    button.addEventListener("click", () => {
      if (pickField === "start") setOrigin(item);
      else {
        chosenDestination = item;
        if (!submitAfterPick) $("prompt").value = item.code || item.label || item.name;
      }
      message();
      const resume = submitAfterPick;
      picker.close();
      if (resume) generate();
    });
    $("choices").append(button);
  }
}
async function searchChoices() {
  const token = ++pickerToken;
  const q = $("search").value.trim();
  try {
    const directory = pickField === "destination" && !pickOptions;
    const page = directory
      ? await api("/api/classrooms?" + new URLSearchParams({ q, offset: pageOffset, limit: pageSize, lang }))
      : null;
    const records = page ? page.items : pickOptions
      ? pickOptions.filter((r) => folded([r.name, r.label, r.area, r.index, ...(r.faculties || [])].join(" ")).includes(folded(q)))
      : await api("/api/checkpoints?" + new URLSearchParams({ rooms: 1, q, lang }));
    if (token !== pickerToken || !picker.open) return;
    $("picker-pages").hidden = !page || page.total <= pageSize;
    if (page) {
      $("previous-rooms").disabled = page.offset === 0;
      $("next-rooms").disabled = page.offset + page.limit >= page.total;
      $("room-page").textContent = t("range", page.total ? page.offset + 1 : 0, page.offset + records.length, page.total);
    }
    $("picker-note").textContent = page
      ? q
        ? t("roomsFound", page.total)
        : t("roomsListed", page.total)
      : !records.length
      ? t("noMatch")
      : pickOptions
        ? t("chooseMeant")
        : t("selectView");
    showChoices(records);
    $("choices").scrollTop = 0;
  } catch {
    if (token === pickerToken) $("picker-note").textContent = t("searchDown");
  }
}
function openPicker(field = "start", options = null, resume = false, locate = false) {
  pickField = field;
  pickOptions = options;
  pageOffset = 0;
  $("picker-pages").hidden = true;
  submitAfterPick = resume;
  const start = field === "start";
  $("picker-title").textContent = start ? t("pickStart") : options ? t("pickDestination") : t("directory");
  $("search").setAttribute("aria-label", start ? t("searchCheckpoints") : t("searchRooms"));
  $("search").placeholder = start ? t("searchStartHint") : t("searchRoomHint");
  $("search").value = "";
  $("picker-locate").hidden = !start || Boolean(options);
  $("choices").replaceChildren();
  $("picker-note").textContent = t("loadingCheckpoints");
  if (!picker.open) picker.showModal();
  $("search").focus();
  if (locate) nearby();
  else searchChoices();
}
$("choose-start").addEventListener("click", () => openPicker());
$("browse-rooms").addEventListener("click", (event) => {
  event.preventDefault();
  openPicker("destination");
});
for (const [id, delta] of [["previous-rooms", -pageSize], ["next-rooms", pageSize]]) {
  $(id).addEventListener("click", () => {
    pageOffset = Math.max(0, pageOffset + delta);
    searchChoices();
  });
}
$("locate").addEventListener("click", () => openPicker("start", null, false, true));
$("picker-locate").addEventListener("click", nearby);
$("close-picker").addEventListener("click", () => picker.close());
picker.addEventListener("close", () => {
  ++pickerToken;
  clearTimeout(searchTimer);
});
$("search").addEventListener("input", () => {
  ++pickerToken;
  pageOffset = 0;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(searchChoices, 140);
});

function meters(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}
function distanceLabel(distance) {
  if (distance < 1000) return Math.round(distance) + " m";
  return (distance / 1000).toLocaleString(lang, { maximumFractionDigits: 1 }) + " km";
}
async function nearby() {
  const token = ++pickerToken;
  $("picker-note").textContent = t("lookingNearby");
  try {
    if (!navigator.geolocation) throw new Error("This browser does not provide location access.");
    const [position, anchors] = await Promise.all([
      new Promise((ok, fail) =>
        navigator.geolocation.getCurrentPosition(ok, fail, {
          enableHighAccuracy: true,
          timeout: 12000,
          maximumAge: 30000,
        }),
      ),
      api("/api/checkpoints?" + new URLSearchParams({ pins: 1, lang })),
    ]);
    if (token !== pickerToken || !picker.open) return;
    const { latitude, longitude, accuracy } = position.coords;
    const nearest = anchors
      .map((a) => ({ ...a, distance: meters(latitude, longitude, a.pin.lat, a.pin.lon) }))
      .sort((a, b) => a.distance - b.distance);
    if (!nearest.length) throw new Error("Building pins are unavailable.");
    const note =
      nearest[0].distance > 1000
        ? t("closest", distanceLabel(nearest[0].distance))
        : t("accuracy", distanceLabel(accuracy));
    $("picker-note").textContent = note + " " + t("confirmView");
    showChoices(nearest.slice(0, 6));
  } catch (e) {
    if (token !== pickerToken || !picker.open) return;
    await searchChoices();
    if (picker.open && pickerToken === token + 1) {
      $("picker-note").textContent = (e.code === 1 ? t("declined") : t("noLocation")) + " " + t("chooseBelow");
    }
  }
}

// Text the page writes itself. Route steps and notices are fetched again by the caller.
function labelPage() {
  translatePage();
  $("example-text").textContent = t("tryExample", t("examplePrompt"));
  if (isDefault("prompt", $("prompt").value.trim())) $("prompt").value = t("prompt");
  if (origin) setOrigin(origin);
  else $("start-name").textContent = t("chooseStart");
  if (route?.steps.length) {
    labelRoute();
    showNow();
    if (route.video && route.video.state !== "ready") $("render-label").textContent = renderLabel(route.video);
  } else {
    $("video-kind").textContent = t("kindExample");
    $("route-title").textContent = exampleFailed ? t("exampleMissing") : t("loading");
    $("count").textContent = t("noCount");
  }
}
async function renameOrigin() {
  // A classroom keeps its catalogue name. A checkpoint can be named differently in each language.
  const index = origin?.index;
  if (typeof index !== "number") return;
  try {
    const [record] = await api("/api/checkpoints?" + new URLSearchParams({ q: "#" + index, lang }));
    if (record && origin?.index === index) setOrigin(record);
  } catch {
    // The name stays as it was until the next route.
  }
}
for (const button of document.querySelectorAll("[data-lang]")) {
  button.addEventListener("click", () => {
    if (!setLanguage(button.dataset.lang)) return;
    message();
    labelPage();
    renameOrigin();
    rerun(message);
  });
}

// Open the route a link asks for. Anything the planner needs to ask goes through the usual pickers.
async function openLink() {
  const from = link.get("from");
  if (from && /^\d+$/.test(from)) {
    try {
      const [record] = await api("/api/checkpoints?" + new URLSearchParams({ q: "#" + from, lang }));
      if (record) setOrigin(record);
    } catch {
      // The planner will ask for the starting point.
    }
  } else if (from) {
    linkOrigin = from;
  }
  if (!link.get("to")) return;
  $("prompt").value = link.get("to");
  if (link.get("dest")) chosenDestination = { index: link.get("dest") };
  await generate();
}

labelPage();
if (location.hash === "#classrooms") openPicker("destination");
function firstExample() {
  loadExample()
    .then((result) => {
      if (route) return;
      // The language was switched while the example was on its way.
      if (result.lang !== lang) firstExample();
      else showRoute(result, loadExample);
    })
    .catch(() => {
      if (route) return;
      exampleFailed = true;
      $("route-title").textContent = t("exampleMissing");
      message(t("exampleFailed"));
    });
}
// The example fills the page unless a link brings its own route.
if (link.get("to")) openLink().then(() => route || firstExample());
else openLink().then(firstExample);
