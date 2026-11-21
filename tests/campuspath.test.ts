import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { campusRequest, planCampusRoute, toCampusAnswer } from "@/lib/campuspath/assistant";
import { planOutcome, planRoute } from "@/lib/campuspath/client";
import {
  appVideo,
  campusHref,
  campusJourneyHref,
  isVideoKey,
  parseCampusLink,
  parseMediaName,
  pickByHint,
  rankPins,
  routeEntrance,
  routeLink,
  routeTitle,
  sharedHref,
  stepEnd,
} from "@/lib/campuspath/links";
import { leaveBy, mapsDirectionsUrl, mapsEmbedUrl } from "@/lib/campuspath/maps";
import { groupRooms } from "@/lib/campuspath/rooms";
import { campuspathConfig, DEFAULT_PORT } from "@/lib/campuspath/service";
import type { Checkpoint, Classroom, Route, Step } from "@/lib/campuspath/types";

const KEY = "2096d2c5366c9e70453ee895";
const AC_PIN = { lat: 45.7474382, lon: 21.2261812, name: "Facultatea de Automatică și Calculatoare" };

function step(index: number, name: string, time: number, extra: Partial<Step> = {}): Step {
  return {
    index,
    name,
    label: name,
    area: "Automatică și Calculatoare",
    floor: null,
    named: true,
    thumb: null,
    url: `https://visit360.upt.ro/#media=${index}`,
    time,
    instruction: `Go on from ${name}.`,
    arrivalYaw: null,
    yaw: 0,
    pitch: 0,
    kind: "walk",
    ...extra,
  };
}

function room(extra: Partial<Classroom> = {}): Classroom {
  return {
    index: "room:electro-b527",
    code: "B527",
    name: "B527",
    label: "B527",
    area: "Electro · Bd. Vasile Pârvan 2",
    faculties: ["Automatică și Calculatoare"],
    level: "Etaj 5",
    coverage: "checkpoint",
    reach: "near",
    checkpoint: 389,
    checkpointName: "Palierul scării",
    thumb: null,
    url: null,
    aliases: [],
    sources: [],
    ...extra,
  };
}

const route: Route = {
  steps: [step(355, "AC entrance", 0, { pin: AC_PIN }), step(408, "Main hall", 3, { floor: 0 }), step(389, "Stair landing", 6, { floor: 4 })],
  duration: 9,
  lang: "en",
  coverage: "checkpoint",
  destination: room(),
  notice: "The video ends at the stair landing.",
  video: { state: "ready", key: KEY, url: `/media/${KEY}.mp4`, poster: `/media/${KEY}.jpg` },
};

describe("campus addresses", () => {
  it("builds and reads route addresses, dropping what is out of bounds", () => {
    expect(campusHref({ from: "355", to: "B527", dest: "room:electro-b527" })).toBe("/campus?from=355&to=B527&dest=room%3Aelectro-b527");
    expect(campusHref({})).toBe("/campus");
    expect(campusHref({ to: "  ", dest: "../admin" })).toBe("/campus");
    expect(parseCampusLink({ from: "355", to: ["B527", "x"], dest: "room:electro-b527", lang: "ro" })).toEqual({
      from: "355",
      to: "B527",
      dest: "room:electro-b527",
      lang: "ro",
    });
    expect(parseCampusLink(new URLSearchParams("to=A315&dest=javascript:alert(1)&lang=fr&from=" + "x".repeat(201)))).toEqual({ to: "A315" });
  });

  it("builds the door-to-door journey link with its context, and keeps the context out of shared links", () => {
    const href = campusJourneyHref({ to: "A315", building: "Clădirea Electro", at: "10:00", course: "Big Data" });
    expect(href).toBe("/campus?to=A315&building=Cl%C4%83direa+Electro&at=10%3A00&course=Big+Data");
    expect(parseCampusLink(new URL(href, "http://x").searchParams)).toEqual({ to: "A315", building: "Clădirea Electro", at: "10:00", course: "Big Data" });
    expect(campusJourneyHref({ to: "A315", at: "25:00", building: null })).toBe("/campus?to=A315");
    const futureClass = { to: "A315", at: "10:00", date: "2026-11-23", course: "Big Data" };
    expect(parseCampusLink(new URL(campusJourneyHref(futureClass), "http://x").searchParams)).toEqual(futureClass);
    expect(parseCampusLink({ to: "A315", date: "2026-02-30" })).toEqual({ to: "A315" });
    expect(sharedHref(futureClass)).toBe("/campus?to=A315");
    expect(sharedHref({ to: "A315", building: "Electro", at: "10:00", course: "Big Data", dest: "room:electro-a315" })).toBe(
      "/campus?to=A315&dest=room%3Aelectro-a315",
    );
  });

  it("names a route and the address that opens it again", () => {
    expect(routeTitle(route)).toBe("AC entrance → B527");
    expect(routeLink(route)).toEqual({ from: "355", to: "B527", dest: "room:electro-b527" });
    // A walk that started at the entrance the planner chose opens the same journey: no `from`.
    expect(routeLink({ ...route, automatic: true })).toEqual({ to: "B527", dest: "room:electro-b527" });
    const place: Route = { steps: [step(412, "AC dean's office corridor", 0)], duration: 0, lang: "en", video: null };
    expect(routeTitle(place)).toBe("AC dean's office corridor");
    expect(routeLink(place)).toEqual({ from: "412", to: "#412" });
    const unmapped: Route = { steps: [], duration: 0, lang: "en", coverage: "unmapped", destination: room({ coverage: "unmapped", reach: "none", code: "A624", name: "A624" }), video: null };
    expect(routeTitle(unmapped)).toBe("A624");
    expect(routeLink(unmapped)).toEqual({ to: "A624", dest: "room:electro-b527" });
  });

  it("finds the entrance a journey starts at", () => {
    expect(routeEntrance(route)?.pin).toEqual(AC_PIN);
    expect(routeEntrance({ ...route, steps: route.steps.slice(1) })).toBeNull();
  });
});

describe("campus media", () => {
  it("accepts only 24-hex keys and mp4/jpg names", () => {
    expect(isVideoKey(KEY)).toBe(true);
    for (const bad of ["", KEY.toUpperCase(), KEY + "0", "../../etc/passwd", KEY.slice(1)]) expect(isVideoKey(bad)).toBe(false);
    expect(parseMediaName(`${KEY}.mp4`)).toEqual({ key: KEY, kind: "mp4" });
    expect(parseMediaName(`${KEY}.jpg`)).toEqual({ key: KEY, kind: "jpg" });
    for (const bad of [`${KEY}.json`, `${KEY}.mp4.exe`, `x${KEY}.mp4`, `${KEY}`, `../${KEY}.mp4`]) expect(parseMediaName(bad)).toBeNull();
  });

  it("serves ready videos through the app and stops each step on its last frame", () => {
    expect(appVideo(route.video)).toEqual({ state: "ready", key: KEY, url: `/api/campus/media/${KEY}.mp4`, poster: `/api/campus/media/${KEY}.jpg` });
    const rendering = { state: "rendering" as const, key: KEY, completed: 2, total: 9 };
    expect(appVideo(rendering)).toBe(rendering);
    expect(appVideo(null)).toBeNull();
    expect(stepEnd(route, 0)).toBeCloseTo(2.94);
    expect(stepEnd(route, 2)).toBeCloseTo(8.94);
  });
});

describe("Locate me and rooms that share a code", () => {
  const pin = (index: number, lat: number, lon: number): Checkpoint => ({
    index,
    name: `Pin ${index}`,
    label: "",
    area: "",
    floor: null,
    named: true,
    thumb: null,
    url: "",
    pin: { lat, lon, name: `Pin ${index}` },
  });

  it("ranks building pins nearest first and leaves out checkpoints without a pin", () => {
    const points = [pin(16, 45.7536, 21.2251), pin(355, AC_PIN.lat, AC_PIN.lon), pin(360, 45.7455, 21.2295), { ...pin(1, 0, 0), pin: undefined }];
    const ranked = rankPins(points, { lat: 45.7473, lon: 21.2262 }, 2);
    expect(ranked.map((p) => p.index)).toEqual([355, 360]);
    expect(ranked[0].distance).toBeLessThan(30);
    expect(ranked[1].distance).toBeGreaterThan(ranked[0].distance);
  });

  it("settles a code in two buildings by the timetable's building, and only when one matches best", () => {
    const electro = room({ index: "room:electro-a109", code: "A109", area: "Electro · Bd. Vasile Pârvan 2", faculties: ["Automatică și Calculatoare"] });
    const aspc = room({ index: "room:aspc-a109", code: "A109", area: "ASPC · Str. Petre Râmneanțu", faculties: ["Construcții"] });
    expect(pickByHint([electro, aspc], "Clădirea Electro (AC, ETcTI, IEE) Facultatea de Automatică și Calculatoare")?.index).toBe("room:electro-a109");
    expect(pickByHint([electro, aspc], "ASPC – Atelier Școlar pentru Proiectare și Cercetare")?.index).toBe("room:aspc-a109");
    expect(pickByHint([electro, aspc], "Facultatea de")).toBeNull();
    expect(pickByHint([electro, aspc], undefined)).toBeNull();
    expect(pickByHint([electro, { ...aspc, area: "Electro · annex" }], "Electro")).toBeNull();
  });

  it("groups a timetable by room with the kinds held there", () => {
    const rooms = groupRooms(
      [
        { title: "Programming", kind: "course", room: "A315" },
        { title: "Programming", kind: "lab", room: "a 315" },
        { title: "Physics", kind: "seminar", room: "B018" },
        { title: "Physics", kind: "course", room: "ONLINE" },
        { title: "Sport", kind: "other", room: null },
      ],
      (r) => ({ name: r.startsWith("B") ? "Clădirea Electro" : "Corp A", approximate: false }),
      "ro",
      "Facultatea de Automatică și Calculatoare",
    );
    expect(rooms.map((r) => r.room)).toEqual(["A315", "B018"]);
    expect(rooms[0]).toMatchObject({ classes: 2, building: "Corp A", courses: [{ title: "Programming", kinds: ["Curs", "Laborator"] }] });
    expect(rooms[1].hint).toBe("Clădirea Electro Facultatea de Automatică și Calculatoare");
  });
});

describe("Google Maps addresses", () => {
  const destination = { lat: AC_PIN.lat, lng: AC_PIN.lon };
  const origin = { lat: 45.7536, lng: 21.2251 };

  it("uses the keyless embed without a key: directions, or the place alone", () => {
    expect(mapsEmbedUrl({ destination, origin, mode: "walking", locale: "ro" })).toBe(
      "https://www.google.com/maps?saddr=45.753600%2C21.225100&daddr=45.747438%2C21.226181&dirflg=w&hl=ro&output=embed",
    );
    expect(mapsEmbedUrl({ destination, origin, mode: "transit" })).toContain("dirflg=r");
    expect(mapsEmbedUrl({ destination })).toBe("https://www.google.com/maps?q=45.747438%2C21.226181&z=18&hl=en&output=embed");
  });

  it("uses the Maps Embed API with a key", () => {
    const directions = new URL(mapsEmbedUrl({ destination, origin, mode: "bicycling", key: "k-123" }));
    expect(directions.origin + directions.pathname).toBe("https://www.google.com/maps/embed/v1/directions");
    expect(Object.fromEntries(directions.searchParams)).toMatchObject({ key: "k-123", origin: "45.753600,21.225100", destination: "45.747438,21.226181", mode: "bicycling" });
    const place = new URL(mapsEmbedUrl({ destination, key: "k-123" }));
    expect(place.pathname).toBe("/maps/embed/v1/place");
    expect(place.searchParams.get("q")).toBe("45.747438,21.226181");
  });

  it("hands over to Google Maps and says when to leave", () => {
    expect(mapsDirectionsUrl({ destination, origin, mode: "driving" })).toBe(
      "https://www.google.com/maps/dir/?api=1&origin=45.753600%2C21.225100&destination=45.747438%2C21.226181&travelmode=driving",
    );
    expect(mapsDirectionsUrl({ destination })).toBe("https://www.google.com/maps/dir/?api=1&destination=45.747438%2C21.226181&travelmode=walking");
    expect(leaveBy("10:00", 17)).toBe("09:43");
    expect(leaveBy("00:10", 30)).toBe("00:00");
    expect(leaveBy("9:00", 5)).toBeNull();
  });
});

describe("planner answers", () => {
  it("maps a 422 to a question and a 200 to a route with app media", () => {
    const question = planOutcome(422, { field: "destination", message: "Several places match.", options: [room()], needsChoice: true });
    expect(question).toEqual({ kind: "question", question: { field: "destination", message: "Several places match.", options: [room()], needsChoice: true } });
    const planned = planOutcome(200, route);
    expect(planned.kind === "route" && planned.route.video).toMatchObject({ url: `/api/campus/media/${KEY}.mp4` });
    expect(() => planOutcome(400, { message: "Send a JSON object with a route request." })).toThrow("Send a JSON object");
  });

  it("gives the assistant a route with its start, steps and in-app link", () => {
    const answer = toCampusAnswer({ kind: "route", route: { ...route, automatic: true, origin: route.steps[0] } });
    expect(answer).toEqual({
      kind: "route",
      title: "AC entrance → B527",
      start: { name: "AC entrance", lat: AC_PIN.lat, lon: AC_PIN.lon },
      coverage: "checkpoint",
      reach: "near",
      notice: "The video ends at the stair landing.",
      steps: [
        { name: "AC entrance", instruction: "Go on from AC entrance.", floor: null },
        { name: "Main hall", instruction: "Go on from Main hall.", floor: 0 },
        { name: "Stair landing", instruction: "Go on from Stair landing.", floor: 4 },
      ],
      durationSeconds: 9,
      link: "/campus?to=B527&dest=room%3Aelectro-b527",
    });
    // A start inside a building has no coordinates.
    const indoor = toCampusAnswer({ kind: "route", route: { ...route, steps: route.steps.slice(1) } });
    expect(indoor.kind === "route" && indoor.start).toEqual({ name: "Main hall", lat: null, lon: null });
  });

  it("gives the assistant questions with values it can send back", () => {
    const checkpoint: Checkpoint = { index: 412, name: "AC dean's office corridor", label: "", area: "AC", floor: 0, named: true, thumb: null, url: "" };
    const answer = toCampusAnswer({ kind: "question", question: { field: "destination", message: "Choose.", options: [room({ index: "room:aspc-a109", name: "A109", area: "ASPC" }), checkpoint], needsChoice: true } });
    expect(answer).toEqual({
      kind: "question",
      field: "destination",
      message: "Choose.",
      options: [
        { label: "A109 · ASPC", value: "room:aspc-a109" },
        { label: "AC dean's office corridor · AC", value: "#412" },
      ],
    });
    const start = toCampusAnswer({ kind: "question", question: { field: "start", message: "Choose.", options: [checkpoint], needsChoice: true } });
    expect(start.kind === "question" && start.options[0].value).toBe("412");
  });

  it("starts at the nearest entrance unless a start is given, and passes choices back as choices", () => {
    expect(campusRequest({ to: "B419", locale: "ro" })).toEqual({ prompt: "B419", lang: "ro", start: "auto" });
    expect(campusRequest({ to: " room:aspc-a109 ", from: "355", locale: "en" })).toEqual({ prompt: "", destination: "room:aspc-a109", from: "355", lang: "en" });
    expect(campusRequest({ to: "B419", from: "room:electro-b018", locale: "en" })).toEqual({ prompt: "B419", start: "room:electro-b018", lang: "en" });
  });
});

describe("planCampusRoute against a mocked service", () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    vi.stubEnv("CAMPUSPATH_URL", "http://campuspath.test/");
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("sends the automatic start and the language, and maps the answer", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ ...route, automatic: true, origin: route.steps[0] }));
    const answer = await planCampusRoute({ to: "B527", locale: "ro" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://campuspath.test/api/routes");
    expect(JSON.parse(String(init?.body))).toEqual({ prompt: "B527", lang: "ro", start: "auto" });
    expect(answer).toMatchObject({ kind: "route", title: "AC entrance → B527", start: { name: "AC entrance" }, link: "/campus?to=B527&dest=room%3Aelectro-b527" });
  });

  it("settles a code in two buildings with the building hint", async () => {
    const electro = room({ index: "room:electro-a109", code: "A109", area: "Electro · Bd. Vasile Pârvan 2" });
    const aspc = room({ index: "room:aspc-a109", code: "A109", area: "ASPC · Str. Petre Râmneanțu", faculties: ["Construcții"] });
    fetchMock
      .mockResolvedValueOnce(Response.json({ field: "destination", message: "Several places match.", options: [electro, aspc], needsChoice: true }, { status: 422 }))
      .mockResolvedValueOnce(Response.json({ ...route, destination: aspc }));
    const answer = await planCampusRoute({ to: "A109", locale: "en", building: "ASPC" });
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({ prompt: "A109", lang: "en", start: "auto", destination: "room:aspc-a109" });
    expect(answer.kind).toBe("route");
    // Without a hint the question goes back to the assistant.
    fetchMock.mockResolvedValueOnce(Response.json({ field: "destination", message: "Several places match.", options: [electro, aspc], needsChoice: true }, { status: 422 }));
    expect((await planCampusRoute({ to: "A109", locale: "en" })).kind).toBe("question");
  });

  it("answers `unavailable` in the student's language when the service cannot be reached", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const answer = await planCampusRoute({ to: "B419", locale: "ro" });
    expect(answer).toEqual({ kind: "unavailable", unavailable: true, message: expect.stringContaining("nu sunt disponibile") });
    // It tried again once after losing the service.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("planRoute keeps a destination the student already chose", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ field: "start", message: "No route.", options: [], needsChoice: true }, { status: 422 }));
    const outcome = await planRoute({ prompt: "A109", destination: "room:aspc-a109", lang: "en", hint: "Electro" });
    expect(outcome.kind).toBe("question");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("service configuration", () => {
  it("reads the port, the Python and an external URL from the environment", () => {
    const config = campuspathConfig({ CAMPUSPATH_PORT: "8787", CAMPUSPATH_PYTHON: "/opt/py" } as unknown as NodeJS.ProcessEnv, "/repo");
    expect(config).toMatchObject({ url: null, port: 8787, python: "/opt/py", dir: "/repo/services/campuspath" });
    expect(campuspathConfig({ CAMPUSPATH_PORT: "nope" } as unknown as NodeJS.ProcessEnv, "/nowhere")).toMatchObject({ port: DEFAULT_PORT, python: "python3" });
    expect(campuspathConfig({ CAMPUSPATH_URL: "https://walks.example.org/" } as unknown as NodeJS.ProcessEnv).url).toBe("https://walks.example.org");
  });
});
