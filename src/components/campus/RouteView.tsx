"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/i18n/client";
import { routeGoal, routeTitle, stepEnd } from "@/lib/campuspath/links";
import type { Route, Source, VideoState } from "@/lib/campuspath/types";
import { campusApi, CampusApiError } from "./api";
import { clock, floorLabel, reveal, roomFacts, routeFloor, slug } from "./format";
import { Thumb } from "./Thumb";

export type RouteKind = "example" | "yours";

/**
 * A planned walk: title, what the video does and does not show, the video with its render
 * progress, Previous / Next step for following it while walking, the chapters, and sharing.
 */
export function RouteView({
  route,
  kind,
  onRetry,
  onShare,
  onCopy,
  copied,
  inJourney = false,
}: {
  route: Route;
  kind: RouteKind;
  /** Leg 2 of a journey: the destination is described in the journey's header. */
  inJourney?: boolean;
  /** Ask again after a failed render: the service starts it over. */
  onRetry: () => void;
  onShare: () => void;
  onCopy: () => void;
  copied: boolean;
}) {
  const t = useT().campus;
  const [video, setVideo] = useState<VideoState | null>(route.video);
  const [active, setActive] = useState(0);
  /** The student has started the video or the step-by-step walk. */
  const [walking, setWalking] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [controls, setControls] = useState(false);
  const [playError, setPlayError] = useState(false);
  const player = useRef<HTMLVideoElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  // Step-by-step playback stops at the end of each checkpoint, so a walker can catch up.
  const stopAt = useRef<number | null>(null);

  const steps = route.steps;
  const title = routeTitle(route);
  const partial = route.coverage === "checkpoint";
  const ready = video?.state === "ready";
  const floor = routeFloor(route, t);
  const last = steps.at(-1);

  // Follow a render until its video is ready.
  useEffect(() => {
    if (!video || video.state === "ready" || video.state === "error") return;
    const timer = window.setTimeout(() => {
      campusApi
        .video(video.key)
        .then(setVideo)
        .catch((e) => setVideo({ state: "error", key: video.key, message: e instanceof CampusApiError && e.message ? e.message : t.route.interrupted }));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [video, t]);

  const playFrom = useCallback(
    async (time: number | undefined, stop?: number) => {
      const el = player.current;
      if (!el || !ready) return;
      stopAt.current = stop ?? null;
      try {
        if (time !== undefined) el.currentTime = time;
        await el.play();
        setPlayError(false);
        setWalking(true);
        setControls(stop === undefined);
        // Hold on the last frame of the step, with its marker in place.
        const watch = () => {
          if (stopAt.current === null || el.paused) return;
          if (el.currentTime < stopAt.current) {
            requestAnimationFrame(watch);
            return;
          }
          el.pause();
          el.currentTime = stopAt.current;
        };
        if (stop !== undefined) requestAnimationFrame(watch);
      } catch {
        setPlayError(true);
      }
    },
    [ready],
  );

  const playStep = useCallback(
    (index: number) => {
      if (index < 0 || index >= steps.length) return;
      setActive(index);
      setWalking(true);
      if (ready) void playFrom(steps[index].time, stepEnd(route, index));
    },
    [steps, ready, playFrom, route],
  );

  const next = useCallback(() => playStep(walking ? active + 1 : 0), [playStep, walking, active]);
  const previous = useCallback(() => playStep(active - 1), [playStep, active]);

  // ← and → walk through the steps, unless typing or using the video's own controls.
  useEffect(() => {
    if (steps.length < 2) return;
    const onKey = (e: KeyboardEvent) => {
      // Not while a dialog (ours or another part of the app) has the keyboard.
      if (e.metaKey || e.ctrlKey || e.altKey || document.querySelector("dialog[open], [aria-modal=true]")) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, video, [contenteditable=true]")) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        previous();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [steps.length, next, previous]);

  const onTime = () => {
    const el = player.current;
    if (!el || !Number.isFinite(el.currentTime)) return;
    let index = 0;
    while (index + 1 < steps.length && steps[index + 1].time <= el.currentTime + 0.01) index++;
    // Holding on the last frame of a step must not tick over to the next one.
    if (stopAt.current !== null && el.currentTime >= stopAt.current - 0.02) return;
    setActive(index);
  };

  const now = steps[active];
  const atEnd = walking && active === steps.length - 1;
  const fileName = `upt-campus-${slug(routeGoal(route)) || "walk"}.mp4`;

  return (
    <article className="card overflow-hidden" aria-labelledby="campus-route-title">
      <div className="border-b border-slate-100 p-4 sm:p-5">
        {steps.length > 0 && (
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
              partial ? "bg-amber-100 text-amber-800" : kind === "example" ? "bg-slate-100 text-slate-700" : "bg-brand-50 text-brand-700"
            }`}
          >
            <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${partial ? "bg-amber-500" : kind === "example" ? "bg-slate-400" : "bg-brand-500"}`} />
            {steps.length === 1 ? t.route.kindPlace : partial ? t.route.kindPartial : kind === "example" ? t.route.kindExample : t.route.kindYours}
          </span>
        )}
        <h2 id="campus-route-title" className="mt-2 break-words text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
          {title || t.route.unmappedTitle}
        </h2>
        {route.destination && !inJourney && <p className="mt-1 text-sm text-slate-600">{roomFacts(route.destination, t).join(" · ")}</p>}
        {route.warning && !inJourney && (
          <p role="note" className="mt-3 rounded-2xl bg-amber-50 px-3.5 py-2.5 text-sm font-medium text-amber-900 ring-1 ring-amber-200">{route.warning}</p>
        )}
        {route.notice && (
          <p className={`mt-3 rounded-2xl px-3.5 py-2.5 text-sm ${partial || !steps.length ? "bg-amber-50 text-amber-900" : "bg-brand-50 text-brand-900"}`}>
            {route.notice}
          </p>
        )}
        {!steps.length && <p className="mt-3 text-sm text-slate-600">{t.route.noSteps}</p>}
        {route.destination && route.destination.sources.length > 0 && (
          <Sources sources={route.destination.sources} label={t.directory.sources(route.destination.sources.length)} />
        )}
      </div>

      {video && (
        <div className="bg-slate-950">
          <div ref={frame} className="relative mx-auto aspect-video w-full max-w-4xl">
            {/* Captions are burned into the video; the current direction is also written below it. */}
            <video
              key={ready ? video.url : "pending"}
              ref={player}
              className="h-full w-full"
              playsInline
              preload="none"
              poster={ready ? video.poster : undefined}
              src={ready ? video.url : undefined}
              controls={controls}
              aria-label={t.route.walkthrough(title)}
              onTimeUpdate={onTime}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => {
                setPlaying(false);
                setControls(false);
                stopAt.current = null;
              }}
            />
            {ready && !playing && !controls && (
              <button
                type="button"
                onClick={() => playFrom(player.current?.ended ? 0 : undefined)}
                className="group absolute inset-0 flex items-center justify-center bg-gradient-to-t from-slate-950/70 via-slate-950/10 to-transparent focus-visible:outline-none"
                aria-label={t.route.play}
              >
                <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/95 text-2xl text-brand-700 shadow-lg ring-4 ring-white/30 transition group-hover:scale-105 group-focus-visible:ring-brand-500 motion-reduce:transition-none">
                  <span aria-hidden className="ml-1">▶</span>
                </span>
              </button>
            )}
            {!ready && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-5 text-center text-white">
                {video.state === "error" ? (
                  <>
                    <p className="max-w-md text-sm">{video.message}</p>
                    <button type="button" className="btn bg-white text-slate-900 hover:bg-slate-100" onClick={onRetry}>
                      {t.route.retry}
                    </button>
                  </>
                ) : (
                  <div role="status" className="w-full max-w-sm">
                    <p className="text-sm font-medium">
                      {video.state === "queued" ? t.route.queued : t.route.rendering(Math.min(video.completed + 1, video.total), video.total)}
                    </p>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/20">
                      <div
                        className="h-full rounded-full bg-white transition-[width] duration-700 motion-reduce:transition-none"
                        style={{ width: `${video.total ? Math.max(4, (video.completed / video.total) * 100) : 4}%` }}
                      />
                    </div>
                    <p className="mt-3 text-xs text-white/75">{t.route.renderHint}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {steps.length > 0 && (
        <div className="space-y-4 p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-600">
            {video && (
              <span>
                <span aria-hidden>⏱️ </span>
                <span className="sr-only">{t.route.duration}: </span>
                {clock(route.duration)}
              </span>
            )}
            <span>
              <span aria-hidden>🧭 </span>
              {t.route.checkpoints(steps.length)}
            </span>
            {floor && (
              <span>
                <span aria-hidden>🏢 </span>
                {floor}
              </span>
            )}
            {ready && (
              <a href={video.url} download={fileName} className="ml-auto text-sm font-medium text-brand-700 hover:underline">
                ⬇ {t.route.download}
              </a>
            )}
          </div>
          {partial && last && <p className="text-sm text-slate-600">{t.route.endsAt(last.name)}</p>}
          {playError && <p role="alert" className="text-sm text-red-700">{t.route.noPlayback}</p>}

          {steps.length > 1 && (
            <div className="rounded-2xl border border-brand-100 bg-brand-50/60 p-3 sm:p-4">
              <div aria-live="polite" className="min-h-[3.5rem]">
                {walking && now ? (
                  <>
                    <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">
                      {t.route.stepOf(active + 1, steps.length)}
                      {floorLabel(now.floor, t) && <span className="font-normal normal-case text-brand-700/80"> · {floorLabel(now.floor, t)}</span>}
                    </p>
                    <p className="mt-0.5 font-semibold text-slate-900">{now.name}</p>
                    <p className="text-base leading-snug text-slate-800">{now.instruction}</p>
                  </>
                ) : (
                  <>
                    <p className="font-medium text-slate-800">{t.route.stepHint}</p>
                    <p className="hidden text-sm text-slate-600 sm:block">{t.route.keysHint}</p>
                  </>
                )}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button type="button" className="btn-secondary py-2.5" onClick={previous} disabled={!walking || active === 0}>
                  <span aria-hidden>←</span> {t.route.previousStep}
                </button>
                <button type="button" className="btn-primary py-2.5" onClick={next} disabled={atEnd}>
                  {t.route.nextStep} <span aria-hidden>→</span>
                </button>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">{t.route.chapters}</h3>
              {ready && steps.length > 1 && <p className="text-xs text-slate-500">{t.route.chaptersHint}</p>}
            </div>
            <div className="flex gap-1.5">
              <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={onCopy} aria-live="polite">
                🔗 {copied ? t.share.copied : t.share.copyLink}
              </button>
              <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={onShare} aria-haspopup="dialog">
                ▦ {t.share.qr}
              </button>
            </div>
          </div>

          <ol className="space-y-1.5">
            {steps.map((step, index) => {
              const current = index === active && (walking || playing);
              const level = floorLabel(step.floor, t);
              return (
                <li
                  key={`${step.index}-${index}`}
                  aria-current={current ? "step" : undefined}
                  className={`flex items-stretch gap-1 rounded-2xl border transition-colors ${current ? "border-brand-300 bg-brand-50" : "border-slate-200 bg-white"}`}
                >
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2.5 rounded-2xl p-2 text-left focus-visible:outline-2 focus-visible:outline-brand-500 sm:gap-3"
                    title={ready ? t.route.playFrom(clock(step.time)) : undefined}
                    aria-label={ready ? t.route.playStep(index + 1, step.name, clock(step.time)) : undefined}
                    onClick={() => {
                      setActive(index);
                      setWalking(true);
                      if (ready) {
                        reveal(frame.current, "nearest");
                        void playFrom(step.time);
                      }
                    }}
                  >
                    <span
                      aria-hidden
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${current ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"}`}
                    >
                      {index + 1}
                    </span>
                    <Thumb src={step.thumb} className="h-11 w-14 sm:h-12 sm:w-16" />
                    <span className="min-w-0 flex-1">
                      <span className="block break-words text-sm font-semibold text-slate-900">{step.name}</span>
                      <span className="block text-xs leading-snug text-slate-600 sm:text-sm">{step.instruction}</span>
                      {level && <span className="mt-0.5 inline-block rounded-full bg-slate-100 px-1.5 py-px text-[11px] text-slate-600">{level}</span>}
                    </span>
                    {video && <span className="shrink-0 self-start pt-0.5 text-xs tabular-nums text-slate-500">{clock(step.time)}</span>}
                  </button>
                  <a
                    href={step.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={t.route.openView}
                    aria-label={t.route.openNamed(step.name)}
                    className="flex w-10 shrink-0 items-center justify-center rounded-r-2xl text-slate-400 transition hover:bg-slate-50 hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-brand-500"
                  >
                    <span aria-hidden>↗</span>
                  </a>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </article>
  );
}

function Sources({ sources, label }: { sources: Source[]; label: string }) {
  return (
    <details className="mt-3 text-sm text-slate-600">
      <summary className="cursor-pointer select-none text-brand-700 hover:underline">{label}</summary>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        {sources.map((source, i) => (
          <li key={i} className="break-words">
            {source.url ? (
              <a href={source.url} target="_blank" rel="noopener noreferrer" className="text-brand-700 hover:underline">
                {source.title}
              </a>
            ) : (
              source.title
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
