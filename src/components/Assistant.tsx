"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AssistantChoice, DayPreview } from "@/lib/assistant/choices";
import { SCHEDULE_CHANGED } from "./Calendar";
import { DayPreviewCard } from "./DayPreview";
import { useLocation } from "./LocationProvider";
import { recorderSupported, startRecording, type Recording } from "./voiceRecorder";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  pending?: boolean;
  /** Tappable options offered with this reply. */
  choices?: AssistantChoice[];
  /** A proposed calendar change to accept. */
  preview?: DayPreview;
  /** The stored message's id, which accepting a preview refers to. */
  dbId?: number;
}

type VoiceLang = "ro-RO" | "en-GB";

/* The Web Speech API is not in TypeScript's DOM library; this is the part used here. */
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

function recognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as (new () => SpeechRecognitionLike) | null;
}

const TOOL_LABELS: Record<string, string> = {
  get_schedule: "Checking your timetable…",
  get_next_event: "Checking what's next…",
  find_exams: "Looking up exams…",
  find_free_slots: "Finding free slots…",
  find_meeting_slots: "Looking for times that work…",
  check_conflicts: "Checking your calendar…",
  save_contact: "Saving the contact…",
  show_choices: "Preparing options…",
  get_directions: "Working out the route…",
  list_my_courses: "Reading your courses…",
  hide_class: "Updating your timetable…",
  move_class: "Updating your timetable…",
  move_class_once: "Preparing the change…",
  restore_class: "Updating your timetable…",
  add_personal_event: "Adding to your calendar…",
  move_personal_event: "Moving the event…",
  remove_personal_event: "Updating your calendar…",
  email_calendar: "Emailing your calendar…",
};

const SUGGESTIONS = [
  "What's next?",
  "Ce am mâine?",
  "When's the earliest I can play tennis?",
  "When can I meet someone from TI 3.2?",
  "Where is my next exam?",
  "Cum ajung la sala următoare?",
];

/** The date badge of a slot card: day of month and short month name. */
function DateBadge({ date, locale }: { date: string; locale: string }) {
  const d = new Date(`${date}T12:00:00Z`);
  const month = new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(d).replace(".", "");
  return (
    <span className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-lg bg-brand-600 text-white" aria-hidden>
      <span className="text-[10px] font-medium uppercase leading-none opacity-80">{month}</span>
      <span className="text-base font-semibold leading-tight">{d.getUTCDate()}</span>
    </span>
  );
}

function Choices({ choices, locale, onPick }: { choices: AssistantChoice[]; locale: string; onPick: (c: AssistantChoice) => void }) {
  const slots = choices.filter((c) => c.date);
  const answers = choices.filter((c) => !c.date);
  return (
    <div className="space-y-2" role="group" aria-label="Suggested answers">
      {slots.length > 0 && (
        <div className="grid gap-2">
          {slots.map((c, i) => (
            <button
              key={`s${i}`}
              type="button"
              onClick={() => onPick(c)}
              className="flex items-center gap-3 rounded-xl border border-brand-200 bg-white px-3 py-2 text-left shadow-sm transition hover:border-brand-500 hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-brand-500"
            >
              <DateBadge date={c.date!} locale={locale} />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-slate-900">{c.label}</span>
                {c.start && !c.label.includes(c.start) && (
                  <span className="block text-xs text-slate-500">{c.end ? `${c.start}–${c.end}` : c.start}</span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
      {answers.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {answers.map((c, i) => (
            <button
              key={`a${i}`}
              type="button"
              onClick={() => onPick(c)}
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-brand-500 hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-brand-500"
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Text prepared for speech: no URLs or markdown punctuation. */
function speakable(text: string): string {
  return text.replace(/https?:\/\/\S+/g, "").replace(/[*_#`>]/g, "").replace(/\s+/g, " ").trim();
}

const RO_WORDS = new Set(["si", "la", "de", "ai", "este", "esti", "cu", "pentru", "sau", "nu", "un", "o", "maine", "azi", "ora", "ce", "care", "pe", "din", "sunt", "poti", "vrei", "ai", "am", "intre", "dupa"]);
const EN_WORDS = new Set(["the", "you", "and", "is", "at", "to", "your", "on", "of", "are", "have", "with", "for", "what", "when", "can", "next", "free", "from"]);

/**
 * The language to read a reply in, judged by its common words rather than by accents,
 * so an English answer that names a Romanian course is still read in English.
 */
function replyLang(text: string, fallback: VoiceLang): VoiceLang {
  let ro = 0;
  let en = 0;
  for (const w of text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z]+/)) {
    if (RO_WORDS.has(w)) ro++;
    if (EN_WORDS.has(w)) en++;
  }
  return ro > en ? "ro-RO" : en > ro ? "en-GB" : fallback;
}

function pickVoice(voices: SpeechSynthesisVoice[], lang: VoiceLang): SpeechSynthesisVoice | null {
  const norm = (v: SpeechSynthesisVoice) => v.lang.replace("_", "-").toLowerCase();
  return voices.find((v) => norm(v) === lang.toLowerCase()) ?? voices.find((v) => norm(v).startsWith(lang.slice(0, 2))) ?? null;
}

const RECOGNITION_ERRORS: Record<string, string> = {
  "not-allowed": "Microphone access is blocked. Allow it with the icon in the address bar, and on a Mac also under System Settings → Privacy & Security → Microphone.",
  "service-not-allowed": "This browser does not allow speech recognition here. In Safari, turn on Dictation or Siri in System Settings; or use Chrome or Edge.",
  "audio-capture": "No microphone was found. Check that one is connected and selected in your system's sound settings.",
  network: "Speech recognition could not reach its online service. Check your connection. Brave and some privacy settings block it, so use Chrome, Edge or Safari.",
  "no-speech": "I didn't hear anything. Tap the microphone, wait for it to turn red, then speak.",
};

function Linkified({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s)]+)/g);
  return (
    <>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a key={i} href={part} target="_blank" rel="noreferrer" className="font-medium underline">
            {part.includes("google.com/maps") ? "Open map" : part}
          </a>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

export function Assistant() {
  const { position, status: locationStatus, enable: enableLocation, disable: disableLocation } = useLocation();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [engine, setEngine] = useState<"gemini" | "claude" | "basic" | null>(null);
  const [listening, setListening] = useState(false);
  const [speak, setSpeak] = useState(false);
  const [lang, setLang] = useState<VoiceLang>("ro-RO");
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  // With Gemini, speech is recorded and transcribed by the server instead of the browser.
  const recording = useRef<Recording | null>(null);
  const engineRef = useRef(engine);
  useEffect(() => {
    engineRef.current = engine;
  }, [engine]);
  const serverVoice = engine === "gemini";
  const scroller = useRef<HTMLDivElement>(null);
  // Bumped whenever speech is started or cancelled, so a finished utterance only runs
  // its follow-up (re-opening the mic) if nothing interrupted it.
  const speechToken = useRef(0);
  // The latest `send`, for speech-recognition callbacks created before it changed.
  const sendRef = useRef<(text: string, spoken?: boolean) => void>(() => {});
  // Voices load asynchronously in most browsers.
  const voices = useRef<SpeechSynthesisVoice[]>([]);
  // Chrome can garbage-collect an utterance nothing refers to, cutting it off silently.
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const missingVoiceNoted = useRef(false);
  // Read at send time, so a question asked right after sharing uses the fresh fix.
  const positionRef = useRef(position);
  useEffect(() => {
    positionRef.current = position;
  }, [position]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- feature detection must wait for the browser
    setVoiceSupported(!!recognitionCtor() || recorderSupported());
    // Listen in the browser's language unless the student switches it.
    if (!navigator.language.toLowerCase().startsWith("ro")) setLang("en-GB");
    const synth = "speechSynthesis" in window ? window.speechSynthesis : null;
    const loadVoices = () => {
      if (synth) voices.current = synth.getVoices();
    };
    loadVoices();
    synth?.addEventListener("voiceschanged", loadVoices);
    fetch("/api/assistant")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        setEngine(data.engine);
        setMessages(
          data.messages.map((m: { id: number; role: Message["role"]; content: string; choices?: AssistantChoice[]; preview?: DayPreview }) => ({
            ...m,
            id: String(m.id),
            dbId: m.id,
          })),
        );
      })
      .catch(() => {});
    const token = speechToken;
    return () => {
      token.current++;
      recognition.current?.abort();
      recording.current?.cancel();
      synth?.removeEventListener("voiceschanged", loadVoices);
      synth?.cancel();
    };
  }, []);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages, activity]);

  /** Stops speech; returns whether anything was speaking. */
  const stopSpeaking = useCallback(() => {
    speechToken.current++;
    const synth = "speechSynthesis" in window ? window.speechSynthesis : null;
    if (!synth || !(synth.speaking || synth.pending)) return false;
    synth.cancel();
    return true;
  }, []);

  const say = useCallback(
    (text: string, then?: () => void) => {
      if (!("speechSynthesis" in window)) {
        setNotice("This browser cannot read answers aloud.");
        then?.();
        return;
      }
      const synth = window.speechSynthesis;
      const wasSpeaking = stopSpeaking();
      const token = speechToken.current;
      const target = replyLang(text, lang);
      const utterance = new SpeechSynthesisUtterance(speakable(text));
      const voice = pickVoice(voices.current.length ? voices.current : synth.getVoices(), target);
      if (voice) {
        utterance.voice = voice;
        utterance.lang = voice.lang;
      } else {
        utterance.lang = target;
        if (target === "ro-RO" && voices.current.length && !missingVoiceNoted.current) {
          missingVoiceNoted.current = true;
          setNotice("No Romanian voice is installed on this device, so Romanian answers use the default voice. On a Mac, add one under System Settings → Accessibility → Spoken Content.");
        }
      }
      utterance.onend = () => {
        if (token === speechToken.current) then?.();
      };
      utterance.onerror = (e) => {
        if (e.error === "interrupted" || e.error === "canceled") return;
        setNotice(
          e.error === "not-allowed"
            ? "The browser blocked reading aloud. Click 🔊 next to a message to hear it."
            : `Reading aloud failed (${e.error}). Check that the device's sound is on.`,
        );
        if (token === speechToken.current) then?.();
      };
      utteranceRef.current = utterance;
      const start = () => {
        if (token !== speechToken.current) return;
        // Chrome can be left paused after cancel(); resume() is harmless otherwise.
        synth.resume();
        synth.speak(utterance);
      };
      // Chrome silently drops speech started in the same moment as cancel().
      if (wasSpeaking) setTimeout(start, 150);
      else start();
    },
    [lang, stopSpeaking],
  );

  /** Records a question and has the server transcribe it (Gemini), then sends it as spoken. */
  const record = useCallback(async () => {
    if (recording.current) return;
    stopSpeaking();
    setNotice(null);
    try {
      recording.current = await startRecording(async (audio) => {
        recording.current = null;
        setListening(false);
        if (!audio) {
          setNotice(RECOGNITION_ERRORS["no-speech"]);
          return;
        }
        setTranscribing(true);
        try {
          const res = await fetch("/api/assistant/transcribe", { method: "POST", headers: { "content-type": audio.type }, body: audio });
          const data = await res.json().catch(() => ({}));
          const text = typeof data.text === "string" ? data.text.trim() : "";
          if (!res.ok) setNotice(data.error ?? "The recording could not be transcribed. Please try again.");
          else if (!text) setNotice(RECOGNITION_ERRORS["no-speech"]);
          // A question asked by voice is answered by voice.
          else sendRef.current(text, true);
        } catch {
          setNotice("The recording could not be sent. Check your connection and try again.");
        } finally {
          setTranscribing(false);
        }
      });
      setListening(true);
      if (!recording.current.autoStops) setNotice("Tap the microphone again when you have finished speaking.");
    } catch (err) {
      const name = (err as { name?: string }).name;
      setNotice(
        name === "NotAllowedError" || name === "SecurityError"
          ? RECOGNITION_ERRORS["not-allowed"]
          : name === "NotFoundError"
            ? RECOGNITION_ERRORS["audio-capture"]
            : `The microphone could not start (${(err as Error).message}).`,
      );
    }
  }, [stopSpeaking]);

  const listen = useCallback(() => {
    if (engineRef.current === "gemini" && recorderSupported()) {
      void record();
      return;
    }
    const Ctor = recognitionCtor();
    if (!Ctor || recognition.current) return;
    stopSpeaking();
    const rec = new Ctor();
    rec.lang = lang;
    rec.interimResults = true;
    rec.continuous = false;
    let finalText = "";
    let heard = "";
    let failed = false;
    rec.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) {
        text += e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText = text;
      }
      heard = text;
      setInput(text);
    };
    rec.onerror = (e) => {
      if (e.error === "aborted") return;
      failed = true;
      setNotice(
        RECOGNITION_ERRORS[e.error] ??
          (e.error === "language-not-supported"
            ? `This browser cannot recognise ${lang === "ro-RO" ? "Romanian" : "English"}. Switch the voice language under the microphone.`
            : `Voice input failed (${e.error}). Please try again.`),
      );
    };
    rec.onend = () => {
      setListening(false);
      recognition.current = null;
      // Safari often ends without marking the last result final, so fall back to what it heard.
      const question = (finalText || heard).trim();
      // A question asked by voice is answered by voice.
      if (question) sendRef.current(question, true);
      else if (!failed) setNotice(RECOGNITION_ERRORS["no-speech"]);
    };
    recognition.current = rec;
    setListening(true);
    setNotice(null);
    try {
      rec.start();
    } catch (err) {
      recognition.current = null;
      setListening(false);
      setNotice(`The microphone could not start (${(err as Error).message}).`);
    }
  }, [lang, stopSpeaking, record]);

  const send = useCallback(
    async (text: string, spoken = false) => {
      const message = text.trim();
      if (!message || busy) return;
      const replyId = `a-${Date.now()}`;
      setMessages((m) => [...m, { id: `u-${Date.now()}`, role: "user", content: message }, { id: replyId, role: "assistant", content: "", pending: true }]);
      setInput("");
      setBusy(true);
      setNotice(null);
      setActivity("Thinking…");
      let reply = "";
      let offered: AssistantChoice[] = [];
      try {
        const res = await fetch("/api/assistant", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message, spoken, location: positionRef.current }),
        });
        if (!res.ok || !res.body) throw new Error(res.status === 401 ? "Your session has expired. Please sign in again." : "The assistant is unavailable right now.");
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            const chunk = JSON.parse(line);
            if (chunk.type === "tool") setActivity(TOOL_LABELS[chunk.name] ?? "Working…");
            else if (chunk.type === "text") {
              reply += (reply ? "\n\n" : "") + chunk.text;
              setMessages((m) => m.map((x) => (x.id === replyId ? { ...x, content: reply, pending: false } : x)));
            } else if (chunk.type === "done") {
              setEngine(chunk.engine);
              if (chunk.notice) setNotice(chunk.notice);
              if (chunk.changed) window.dispatchEvent(new Event(SCHEDULE_CHANGED));
              const choices = Array.isArray(chunk.choices) && chunk.choices.length ? (chunk.choices as AssistantChoice[]) : undefined;
              const preview = chunk.preview as DayPreview | undefined;
              if (choices) offered = choices;
              if (preview) offered = [{ label: "Accept", reply: "Yes" }];
              setMessages((m) => m.map((x) => (x.id === replyId ? { ...x, choices, preview, dbId: chunk.messageId } : x)));
            }
          }
        }
        if (!reply) throw new Error("The assistant did not answer. Please try again.");
        // In a spoken conversation, options read aloud are followed by listening for the pick.
        if (speak || spoken) say(reply, spoken && offered.length ? listen : undefined);
      } catch (err) {
        setMessages((m) => m.filter((x) => x.id !== replyId || x.content));
        setNotice((err as Error).message);
      } finally {
        setBusy(false);
        setActivity(null);
      }
    },
    [busy, speak, say, listen],
  );

  useEffect(() => {
    sendRef.current = (text, spoken) => void send(text, spoken);
  }, [send]);

  const toggleMic = () => {
    if (!listening) listen();
    else if (recording.current) recording.current.stop();
    else recognition.current?.stop();
  };

  /** Closes an open microphone without sending what it heard: a tap wins over speech. */
  const cancelListening = () => {
    if (recording.current) {
      recording.current.cancel();
      recording.current = null;
      setListening(false);
    }
    const rec = recognition.current;
    if (!rec) return;
    rec.onend = () => {
      setListening(false);
      recognition.current = null;
    };
    rec.abort();
  };

  const pick = (choice: AssistantChoice) => {
    cancelListening();
    stopSpeaking();
    void send(choice.reply);
  };

  /** Saves the previewed change exactly as shown, without another AI round trip. */
  const accept = async (m: Message) => {
    if (!m.dbId || busy) return;
    cancelListening();
    stopSpeaking();
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/assistant/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: m.dbId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice(data.error ?? "The change could not be saved.");
        return;
      }
      const now = Date.now();
      setMessages((list) => [
        ...list.map((x) => (x.id === m.id && x.preview ? { ...x, preview: { ...x.preview, status: "accepted" as const } } : x)),
        { id: `u-${now}`, role: "user", content: "✓ Accepted" },
        { id: `a-${now}`, role: "assistant", content: data.reply },
      ]);
      if (data.changed) window.dispatchEvent(new Event(SCHEDULE_CHANGED));
      if (speak) say(data.reply);
    } catch {
      setNotice("The server could not be reached. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    stopSpeaking();
    setMessages([]);
    await fetch("/api/assistant", { method: "DELETE" }).catch(() => {});
  };

  const last = messages.at(-1);
  const lastChoices = !busy && last?.role === "assistant" && !last.pending ? last.choices : undefined;

  return (
    <section className="card flex h-full min-h-0 flex-col overflow-hidden">
      <header className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-slate-900">Assistant</h2>
          <p className="truncate text-xs text-slate-500">
            {engine === "gemini"
              ? "Powered by Gemini"
              : engine === "claude"
                ? "Powered by Claude"
                : engine === "basic"
                  ? "Built-in assistant (no AI key set)"
                  : "Ask about classes, exams, free time, directions"}
          </p>
        </div>
        <button
          className={`btn px-2 text-xs ${position ? "bg-emerald-50 text-emerald-700" : "text-slate-500 hover:bg-slate-100"}`}
          onClick={position ? disableLocation : enableLocation}
          title={position ? "Location shared — click to stop" : "Share my location for directions"}
          aria-pressed={!!position}
        >
          {position ? "📍 On" : locationStatus === "asking" ? "📍 …" : "📍 Off"}
        </button>
        <button
          className={`btn px-2 text-xs ${speak ? "bg-brand-50 text-brand-700" : "text-slate-500 hover:bg-slate-100"}`}
          onClick={() => {
            if (speak) stopSpeaking();
            setSpeak(!speak);
          }}
          title="Read answers aloud"
          aria-pressed={speak}
        >
          {speak ? "🔊 On" : "🔈 Off"}
        </button>
        <button className="btn-ghost px-2 text-xs" onClick={clear} title="Clear conversation">Clear</button>
      </header>

      <div ref={scroller} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {!messages.length && (
          <div className="space-y-3 text-sm text-slate-600">
            <p>Ask in Romanian or English — by typing or with the microphone.</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700 hover:border-brand-500 hover:text-brand-700" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className="space-y-2">
            <div className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[88%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${m.role === "user" ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-900"}`}>
                {m.pending ? <span className="text-slate-500">{activity ?? "Thinking…"}</span> : <Linkified text={m.content} />}
                {m.role === "assistant" && !m.pending && (
                  <button className="ml-2 align-middle text-xs opacity-50 hover:opacity-100" onClick={() => say(m.content)} title="Read aloud" aria-label="Read aloud">🔊</button>
                )}
              </div>
            </div>
            {m.preview && (
              <DayPreviewCard
                preview={m.preview}
                locale={lang}
                actions={
                  // Only the latest proposal can be accepted; older ones are history.
                  m === last && m.preview.status === "pending" && !busy ? (
                    <>
                      <button type="button" className="btn-primary px-3 py-1.5 text-xs" onClick={() => void accept(m)}>Accept</button>
                      <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={() => pick({ label: "Other time", reply: "Another time, please." })}>
                        Other time
                      </button>
                    </>
                  ) : undefined
                }
              />
            )}
          </div>
        ))}
        {lastChoices && <Choices choices={lastChoices} locale={lang} onPick={pick} />}
        {busy && activity && messages.at(-1)?.content && <p className="text-xs text-slate-400">{activity}</p>}
      </div>

      {notice && <p role="status" className="border-t border-amber-100 bg-amber-50 px-4 py-2 text-xs text-amber-800">{notice}</p>}

      <form
        className="flex items-end gap-2 border-t border-slate-200 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        {voiceSupported && (
          <div className="flex flex-col items-center gap-1">
            <button
              type="button"
              onClick={toggleMic}
              className={`flex h-10 w-10 items-center justify-center rounded-full text-lg transition ${listening ? "animate-pulse bg-red-500 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
              aria-label={listening ? "Stop listening" : "Talk to the assistant"}
              aria-pressed={listening}
              disabled={busy || transcribing}
            >
              🎤
            </button>
            {/* Server transcription detects the language itself; the browser's needs telling. */}
            {!serverVoice && (
              <button type="button" className="text-[10px] font-medium uppercase tracking-wide text-slate-500 hover:text-brand-600" onClick={() => setLang(lang === "ro-RO" ? "en-GB" : "ro-RO")} title="Voice language">
                {lang === "ro-RO" ? "RO" : "EN"}
              </button>
            )}
          </div>
        )}
        <textarea
          className="field min-h-10 flex-1 resize-none"
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
          placeholder={listening ? "Listening… pause or tap 🎤 when done" : transcribing ? "Transcribing…" : "Ask about your timetable…"}
          aria-label="Message"
        />
        <button className="btn-primary h-10" disabled={busy || !input.trim()}>Send</button>
      </form>
      {!voiceSupported && <p className="px-4 pb-2 text-[11px] text-slate-400">This browser cannot use the microphone here.</p>}
    </section>
  );
}
