"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/i18n/client";
import { campusHref, routeGoal, routeLink, routeTitle, sharedHref, type CampusLink } from "@/lib/campuspath/links";
import type { TimetableRoom } from "@/lib/campuspath/rooms";
import { isClassroom, type CampusPlace, type Classroom, type Question, type Route } from "@/lib/campuspath/types";
import { Mascot } from "../Mascot";
import { campusApi, CampusApiError, type PlanBody } from "./api";
import { ClassroomBrowser } from "./ClassroomBrowser";
import { reveal, roomFacts } from "./format";
import { Journey } from "./Journey";
import type { RouteKind } from "./RouteView";
import { ShareDialog } from "./ShareDialog";
import { StartPicker } from "./StartPicker";
import { Thumb } from "./Thumb";
import { YourRooms } from "./YourRooms";

/** A starting point: a tour checkpoint (number) or a classroom (id), with what to call it. */
interface Start {
  index: number | string;
  name: string;
  area?: string;
}

/** What to plan; the starting point is added when the request is sent. */
interface PlanInput {
  prompt: string;
  destination?: number | string;
  hint?: string;
  /** Start at the building entrance nearest the room, whatever is chosen in the planner. */
  auto?: boolean;
  /** A starting place a link named in words. */
  from?: string;
}

/** Where the journey is for, from a link: the building, the class and its time. */
type Context = Pick<CampusLink, "building" | "at" | "course">;

const START_KEY = "upt.campus.start";

function toStart(place: CampusPlace): Start {
  return { index: place.index, name: place.name, area: place.area };
}

function rememberStart(start: Start | null) {
  try {
    if (start) localStorage.setItem(START_KEY, JSON.stringify(start));
    else localStorage.removeItem(START_KEY);
  } catch {}
}

function recalledStart(): Start | null {
  try {
    const value = JSON.parse(localStorage.getItem(START_KEY) ?? "null") as Start | null;
    if (value && (typeof value.index === "number" || typeof value.index === "string") && typeof value.name === "string") return value;
  } catch {}
  return null;
}

/**
 * The campus page: the student's own rooms, the planner, and the walk in view. A request without
 * a starting point is a door-to-door journey: to the nearest building entrance on a map, then
 * inside on the walkthrough. The address bar follows the route (`/campus?to=…&dest=…`, with
 * `from=` when the student chose a start), and such an address opens it.
 */
export function CampusPage({
  initial,
  rooms,
  hasSemester,
  admin,
  mapsKey,
}: {
  initial: CampusLink;
  rooms: TimetableRoom[];
  hasSemester: boolean;
  admin: boolean;
  /** A Google Maps Embed API key, if configured; otherwise the keyless embed is used. */
  mapsKey: string | null;
}) {
  const messages = useT();
  const t = messages.campus;
  const [prompt, setPrompt] = useState(initial.to ?? "");
  const [start, setStart] = useState<Start | null>(null);
  /** A starting place a link named in words, sent as `from` until a checkpoint is chosen. */
  const [startText, setStartText] = useState<string | null>(null);
  const [result, setResult] = useState<{ route: Route; kind: RouteKind; id: number } | null>(null);
  const [context, setContext] = useState<Context>({ building: initial.building, at: initial.at, course: initial.course });
  const [question, setQuestion] = useState<Question | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [picker, setPicker] = useState<{ locate: boolean } | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("");
  const generation = useRef(0);
  const pending = useRef<PlanInput | null>(null);
  /** Resubmit the pending request once a starting point is picked. */
  const resume = useRef(false);
  /** What "Try again" asks for: the last route request, or the example. */
  const retry = useRef<{ input: PlanInput; from: Start | null } | "example" | null>(null);
  const resultBox = useRef<HTMLDivElement>(null);
  const promptBox = useRef<HTMLTextAreaElement>(null);
  const contextRef = useRef(context);

  const chooseStart = useCallback((next: Start | null) => {
    setStart(next);
    setStartText(null);
    rememberStart(next);
  }, []);

  const failWith = useCallback(
    (e: unknown) => {
      if (e instanceof CampusApiError && e.unavailable) {
        setUnavailable(true);
        return;
      }
      const message = e instanceof CampusApiError ? e.message : "";
      setError(message || (e instanceof CampusApiError && e.status === 0 ? messages.common.status.offline : messages.common.status.somethingWrong));
    },
    [messages],
  );

  const showRoute = useCallback((route: Route, kind: RouteKind) => {
    setResult((previous) => ({ route, kind, id: (previous?.id ?? 0) + 1 }));
    setUnavailable(false);
    // Keep the address bar on the route in view, so it can be copied, bookmarked or put in a timetable.
    const href = kind === "example" ? campusHref({}) : campusHref({ ...routeLink(route), ...contextRef.current });
    if (window.location.pathname + window.location.search !== href) window.history.replaceState(null, "", href);
  }, []);

  const applyContext = (next: Context) => {
    contextRef.current = next;
    setContext(next);
  };

  const plan = useCallback(
    async (input: PlanInput, override?: Start | null, quiet = false) => {
      const mine = ++generation.current;
      const from = input.auto ? null : override !== undefined ? override : start;
      pending.current = input;
      setQuestion(null);
      setError(null);
      setFormError(null);
      setBusy(input.prompt || String(input.destination ?? ""));
      if (!quiet) reveal(resultBox.current);
      const body: PlanBody = { prompt: input.prompt, destination: input.destination, hint: input.hint };
      const fromText = input.auto ? null : (input.from ?? startText);
      if (from) body.start = from.index;
      else if (fromText) body.from = fromText;
      // No starting point: the journey starts at the entrance nearest the room.
      else body.start = "auto";
      try {
        const route = await campusApi.plan(body);
        if (mine !== generation.current) return;
        retry.current = { input, from };
        showRoute(route, "yours");
        // The planner names the starting point it used, in the current language. An entrance it
        // chose itself is not the student's choice, so it is not remembered.
        const used = route.origin ?? route.steps[0];
        if (used && !route.automatic) chooseStart(toStart(used));
      } catch (e) {
        if (mine !== generation.current) return;
        const q = e instanceof CampusApiError ? e.question : null;
        if (q) {
          if (q.field === "start" && q.needsChoice && !q.options.length) {
            // "Where are you starting?": pick one, then the request goes on by itself.
            resume.current = true;
            setPicker({ locate: false });
            setError(q.message);
          } else if (q.options.length) {
            setQuestion(q);
          } else {
            setError(q.message);
            setFormError(q.message);
          }
        } else {
          failWith(e);
        }
      } finally {
        if (mine === generation.current) setBusy(null);
      }
    },
    [start, startText, showRoute, chooseStart, failWith],
  );

  const loadExample = useCallback(async () => {
    const mine = ++generation.current;
    setBusy("example");
    try {
      const route = await campusApi.example();
      if (mine !== generation.current) return;
      retry.current = "example";
      showRoute(route, "example");
    } catch (e) {
      if (mine === generation.current) failWith(e);
    } finally {
      if (mine === generation.current) setBusy(null);
    }
  }, [showRoute, failWith]);

  // First load: open the route the address asks for, else the example. Restore the starting point.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    /* eslint-disable react-hooks/set-state-in-effect -- one-time restore from the address and this device */
    setOrigin(window.location.origin);
    let first: Start | null = null;
    if (initial.from && /^\d+$/.test(initial.from)) {
      first = { index: Number(initial.from), name: `#${initial.from}` };
      setStart(first);
      // Name it properly; the planner does too when the route arrives.
      campusApi
        .checkpoint(Number(initial.from))
        .then((place) => place && setStart((s) => (s && s.index === place.index ? toStart(place) : s)))
        .catch(() => {});
    } else if (initial.from) {
      setStartText(initial.from);
    } else {
      setStart(recalledStart());
    }
    /* eslint-enable react-hooks/set-state-in-effect */
    if (initial.to) {
      // Without `from`, a link (from a class in the calendar) asks for the door-to-door journey.
      const input: PlanInput = {
        prompt: initial.to,
        destination: initial.dest,
        hint: initial.building,
        auto: !initial.from,
        from: first ? undefined : initial.from,
      };
      void plan(input, first);
    } else {
      void loadExample();
    }
  }, [initial, plan, loadExample]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) {
      setFormError(t.planner.emptyPrompt);
      promptBox.current?.focus();
      return;
    }
    applyContext({});
    void plan({ prompt: prompt.trim() });
  };

  const goToRoom = (room: TimetableRoom) => {
    setPrompt(room.room);
    applyContext({ building: room.building ?? undefined });
    void plan({ prompt: room.room, hint: room.hint, auto: true });
  };

  const takeRoom = (room: Classroom) => {
    setBrowsing(false);
    setPrompt(room.code || room.label);
    applyContext({});
    void plan({ prompt: room.code || room.label, destination: room.index, auto: true });
  };

  const answer = (option: CampusPlace) => {
    const q = question;
    const input = pending.current;
    if (!q || !input) return;
    if (q.field === "start") {
      const next = toStart(option);
      chooseStart(next);
      void plan({ ...input, auto: false }, next);
    } else {
      void plan({ ...input, destination: option.index });
    }
  };

  const pickStart = (place: CampusPlace) => {
    const next = toStart(place);
    chooseStart(next);
    setPicker(null);
    if (resume.current && pending.current) {
      resume.current = false;
      void plan({ ...pending.current, auto: false }, next);
    }
  };

  /** "Start from somewhere else": choose a start, then the same destination again. */
  const startElsewhere = () => {
    resume.current = true;
    setPicker({ locate: false });
  };

  const shareLink = result && result.route.steps.length ? origin + sharedHref(routeLink(result.route)) : "";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setSharing(true);
      setError(t.share.copyFailed);
    }
  };

  const retryAll = () => {
    setUnavailable(false);
    setError(null);
    const last = retry.current;
    if (last && last !== "example") void plan(last.input, last.from, true);
    else if (pending.current && !last) void plan(pending.current, undefined, true);
    else void loadExample();
  };

  const startLabel = start?.name ?? startText;

  return (
    <div className="space-y-5">
      <header className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            {t.page.heading}
            <span className="text-brand-500">.</span>
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-600 sm:text-base">{t.page.lead}</p>
        </div>
        <Mascot size={56} className="hidden sm:inline-flex" wave />
      </header>

      <YourRooms rooms={rooms} hasSemester={hasSemester} busyRoom={busy} onGo={goToRoom} />

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,23rem)_minmax(0,1fr)]">
        <section aria-labelledby="campus-plan-title" className="card p-4 sm:p-5 lg:sticky lg:top-20">
          <h2 id="campus-plan-title" className="text-lg font-semibold text-slate-900">
            <span aria-hidden>🗺️ </span>
            {t.planner.title}
          </h2>
          <form onSubmit={submit} className="mt-3 space-y-4" noValidate>
            <div>
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="campus-prompt" className="label mb-0">
                  {t.planner.where}
                </label>
                <button type="button" className="text-sm font-medium text-brand-700 hover:underline focus-visible:outline-2 focus-visible:outline-brand-500" onClick={() => setBrowsing(true)} aria-haspopup="dialog">
                  {t.planner.browse}
                </button>
              </div>
              <textarea
                id="campus-prompt"
                ref={promptBox}
                rows={2}
                maxLength={1000}
                className="field mt-1 resize-none text-base sm:text-sm"
                placeholder={t.planner.placeholder}
                value={prompt}
                aria-describedby="campus-prompt-hint"
                aria-invalid={!!formError}
                onChange={(e) => {
                  setPrompt(e.target.value);
                  setFormError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    e.currentTarget.form?.requestSubmit();
                  }
                }}
              />
              <p id="campus-prompt-hint" className="mt-1 text-xs text-slate-500">
                {t.planner.hint}{" "}
                <button
                  type="button"
                  className="font-medium text-brand-700 hover:underline"
                  onClick={() => {
                    setPrompt(t.planner.examplePrompt);
                    setFormError(null);
                    promptBox.current?.focus();
                  }}
                >
                  {t.planner.tryExample(t.planner.examplePrompt)}
                </button>
              </p>
              {formError && (
                <p role="alert" className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">
                  {formError}
                </p>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between gap-2">
                <span id="campus-start-label" className="label mb-0">
                  {t.planner.start}
                </span>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline focus-visible:outline-2 focus-visible:outline-brand-500"
                  onClick={() => setPicker({ locate: true })}
                  aria-haspopup="dialog"
                >
                  <span aria-hidden>📍</span>
                  {t.planner.locate}
                </button>
              </div>
              <div className="mt-1 flex gap-1.5">
                <button
                  type="button"
                  aria-labelledby="campus-start-label campus-start-value"
                  aria-haspopup="dialog"
                  onClick={() => setPicker({ locate: false })}
                  className={`field flex min-w-0 flex-1 items-center gap-2 text-left ${startLabel ? "" : "text-slate-500"}`}
                >
                  <span aria-hidden>🚩</span>
                  <span id="campus-start-value" className="min-w-0 flex-1 truncate">
                    {startLabel ?? t.planner.chooseStart}
                  </span>
                  <span aria-hidden className="text-slate-400">▾</span>
                </button>
                {startLabel && (
                  <button
                    type="button"
                    className="btn-ghost px-2.5"
                    onClick={() => chooseStart(null)}
                    aria-label={t.planner.clearStart}
                    title={t.planner.clearStart}
                  >
                    <span aria-hidden>✕</span>
                  </button>
                )}
              </div>
              <p className="mt-1 text-xs text-slate-500">{start?.area ?? t.planner.startHint}</p>
            </div>

            <button type="submit" className="btn-primary w-full py-2.5" disabled={!!busy && busy !== "example"}>
              <span aria-hidden>🎬</span> {busy && busy !== "example" ? t.planner.submitting : t.planner.submit}
            </button>
          </form>
        </section>

        <div ref={resultBox} className="min-w-0 scroll-mt-20 space-y-4">
          {busy && busy !== "example" && (
            <p role="status" className="flex items-center gap-2 rounded-2xl bg-white/80 px-4 py-3 text-sm text-slate-700 ring-1 ring-slate-200">
              <span className="typing-dots text-brand-500" aria-hidden>
                <span />
                <span />
                <span />
              </span>
              {t.planner.submitting}
            </p>
          )}
          {unavailable ? (
            <section className="card flex flex-col items-center gap-3 p-6 text-center" aria-labelledby="campus-down-title">
              <Mascot size={72} />
              <h2 id="campus-down-title" className="text-lg font-semibold text-slate-900">
                {t.unavailable.title}
              </h2>
              <p className="max-w-md text-sm text-slate-600">{t.unavailable.body}</p>
              {admin && (
                <p className="max-w-lg rounded-2xl bg-slate-50 px-4 py-3 text-left text-xs text-slate-700 ring-1 ring-slate-200">
                  <strong className="font-semibold">{t.unavailable.adminLabel}: </strong>
                  {t.unavailable.adminHint}
                </p>
              )}
              <button type="button" className="btn-primary" onClick={retryAll}>
                {t.unavailable.retry}
              </button>
            </section>
          ) : (
            <>
              {error && (
                <p role="alert" className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200">
                  {error}
                </p>
              )}
              {question && (
                <section className="card p-4 sm:p-5" aria-labelledby="campus-question">
                  <div className="flex items-start gap-3">
                    <Mascot size={44} />
                    <div className="min-w-0 flex-1">
                      <h2 id="campus-question" className="font-semibold text-slate-900">
                        {question.message}
                      </h2>
                      <p className="text-sm text-slate-600">{t.question.choose}</p>
                    </div>
                  </div>
                  <ul className="mt-3 space-y-1.5">
                    {question.options.map((option) => (
                      <li key={String(option.index)}>
                        <button
                          type="button"
                          onClick={() => answer(option)}
                          className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 p-2 text-left transition hover:border-brand-200 hover:bg-brand-50/60 focus-visible:outline-2 focus-visible:outline-brand-500"
                        >
                          <Thumb src={option.thumb} />
                          <span className="min-w-0 flex-1">
                            <span className="block break-words text-sm font-semibold text-slate-900">{option.name}</span>
                            <span className="block text-xs text-slate-500">
                              {(isClassroom(option) ? roomFacts(option, t) : [option.area, t.picker.checkpoint(option.index)]).join(" · ")}
                            </span>
                          </span>
                          <span aria-hidden className="text-brand-600">→</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  <button type="button" className="btn-ghost mt-2 text-sm" onClick={() => setQuestion(null)}>
                    {t.question.dismiss}
                  </button>
                </section>
              )}
              {result ? (
                <Journey
                  key={result.id}
                  route={result.route}
                  kind={result.kind}
                  context={context}
                  mapsKey={mapsKey}
                  onRetry={retryAll}
                  onShare={() => setSharing(true)}
                  onCopy={copy}
                  copied={copied}
                  onStartElsewhere={startElsewhere}
                />
              ) : (
                !question &&
                !error && (
                  <div className="card flex items-center gap-3 p-5 text-sm text-slate-600" role="status">
                    <Mascot size={44} />
                    {t.route.loading}
                  </div>
                )
              )}
            </>
          )}
          <p className="px-1 text-xs text-slate-500">
            {t.page.credit}{" "}
            <a href="https://visit360.upt.ro/" target="_blank" rel="noopener noreferrer" className="font-medium text-brand-700 hover:underline">
              {t.page.tourLink} ↗
            </a>
          </p>
        </div>
      </div>

      <StartPicker open={!!picker} locate={!!picker?.locate} onClose={() => {
        setPicker(null);
        resume.current = false;
      }} onPick={pickStart} />
      <ClassroomBrowser open={browsing} onClose={() => setBrowsing(false)} onTake={takeRoom} />
      {result && (
        <ShareDialog
          open={sharing}
          onClose={() => setSharing(false)}
          link={shareLink}
          title={routeTitle(result.route)}
          goal={routeGoal(result.route)}
          onCopy={copy}
          copied={copied}
        />
      )}
    </div>
  );
}
