"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SCHEDULE_CHANGED } from "./Calendar";
import { useLocation } from "./LocationProvider";
import { ASK_ASSISTANT, Mascot } from "./Mascot";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  pending?: boolean;
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
  get_directions: "Working out the route…",
  list_my_courses: "Reading your courses…",
  hide_class: "Updating your timetable…",
  move_class: "Updating your timetable…",
  restore_class: "Updating your timetable…",
  add_personal_event: "Adding to your calendar…",
  remove_personal_event: "Updating your calendar…",
};

const SUGGESTIONS = [
  { emoji: "⏭️", text: "What's next?" },
  { emoji: "📅", text: "Ce am mâine?" },
  { emoji: "📝", text: "Where is my next exam?" },
  { emoji: "☕", text: "When am I free this week?" },
  { emoji: "🧭", text: "Cum ajung la sala următoare?" },
];

/** Text prepared for speech: no URLs or markdown punctuation. */
function speakable(text: string): string {
  return text.replace(/https?:\/\/\S+/g, "").replace(/[*_#`>]/g, "").replace(/\s+/g, " ").trim();
}

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

export function Assistant({ onClose }: { onClose?: () => void } = {}) {
  const { position, status: locationStatus, enable: enableLocation, disable: disableLocation } = useLocation();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [engine, setEngine] = useState<"claude" | "basic" | null>(null);
  const [listening, setListening] = useState(false);
  const [speak, setSpeak] = useState(false);
  const [lang, setLang] = useState<VoiceLang>("ro-RO");
  const [voiceSupported, setVoiceSupported] = useState(false);
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  // Read at send time, so a question asked right after sharing uses the fresh fix.
  const positionRef = useRef(position);
  useEffect(() => {
    positionRef.current = position;
  }, [position]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- feature detection must wait for the browser
    setVoiceSupported(!!recognitionCtor());
    fetch("/api/assistant")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        setEngine(data.engine);
        setMessages(data.messages.map((m: { id: number; role: Message["role"]; content: string }) => ({ ...m, id: String(m.id) })));
      })
      .catch(() => {});
    return () => {
      recognition.current?.abort();
      if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    };
  }, []);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages, activity]);

  const say = useCallback(
    (text: string) => {
      if (!("speechSynthesis" in window)) return;
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(speakable(text));
      // Read Romanian answers with a Romanian voice even if the mic is set to English.
      utterance.lang = /[ăâîșşțţ]/i.test(text) ? "ro-RO" : lang;
      window.speechSynthesis.speak(utterance);
    },
    [lang],
  );

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
      try {
        const res = await fetch("/api/assistant", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message, location: positionRef.current }),
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
            }
          }
        }
        if (!reply) throw new Error("The assistant did not answer. Please try again.");
        if (speak || spoken) say(reply);
      } catch (err) {
        setMessages((m) => m.filter((x) => x.id !== replyId || x.content));
        setNotice((err as Error).message);
      } finally {
        setBusy(false);
        setActivity(null);
      }
    },
    [busy, speak, say],
  );

  // Questions asked from elsewhere on the page (the welcome card's quick buttons).
  useEffect(() => {
    const onAsk = (e: Event) => {
      const question = (e as CustomEvent<string>).detail;
      if (question) void send(question);
    };
    window.addEventListener(ASK_ASSISTANT, onAsk);
    return () => window.removeEventListener(ASK_ASSISTANT, onAsk);
  }, [send]);

  const toggleMic = () => {
    if (listening) {
      recognition.current?.stop();
      return;
    }
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    window.speechSynthesis?.cancel();
    const rec = new Ctor();
    rec.lang = lang;
    rec.interimResults = true;
    rec.continuous = false;
    let finalText = "";
    rec.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) {
        text += e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText = text;
      }
      setInput(text);
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") setNotice("Microphone access is blocked. Allow it for this site to talk to the assistant.");
      else if (e.error !== "aborted" && e.error !== "no-speech") setNotice("I couldn't hear that. Please try again.");
    };
    rec.onend = () => {
      setListening(false);
      recognition.current = null;
      // A question asked by voice is answered by voice.
      if (finalText.trim()) void send(finalText, true);
    };
    recognition.current = rec;
    setListening(true);
    rec.start();
  };

  const clear = async () => {
    window.speechSynthesis?.cancel();
    setMessages([]);
    await fetch("/api/assistant", { method: "DELETE" }).catch(() => {});
  };

  return (
    <section className="card flex h-full min-h-0 flex-col overflow-hidden shadow-[0_24px_60px_-12px_rgba(20,36,87,0.35)]">
      <header className="flex items-center gap-2 border-b border-slate-200 bg-gradient-to-r from-brand-50 to-white px-4 py-3">
        <span className="relative">
          <Mascot size={36} />
          <span aria-hidden className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white ${busy ? "bg-amber-400" : "bg-emerald-500"}`} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="whitespace-nowrap text-base font-semibold text-slate-900">Poli</h2>
          <p className="truncate text-xs text-slate-500">
            {engine === "claude" ? "Powered by Claude" : engine === "basic" ? "Built-in assistant (Claude not connected)" : "Ask about classes, exams, free time, directions"}
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
            if (speak) window.speechSynthesis?.cancel();
            setSpeak(!speak);
          }}
          title="Read answers aloud"
          aria-pressed={speak}
        >
          {speak ? "🔊 On" : "🔈 Off"}
        </button>
        <button className="btn-ghost px-2 text-xs" onClick={clear} title="Clear conversation">Clear</button>
        {onClose && (
          <button className="btn-ghost px-2" onClick={onClose} aria-label="Close chat" title="Close chat">✕</button>
        )}
      </header>

      <div ref={scroller} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {!messages.length && (
          <div className="flex flex-col items-center gap-3 pt-1 text-center text-sm text-slate-600">
            <Mascot size={72} wave />
            <div>
              <p className="font-semibold text-slate-900">Salut! What can I help you with?</p>
              <p className="mt-0.5 text-xs">Ask in Romanian or English, by typing or with the microphone 🎤</p>
            </div>
            <div className="grid w-full gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s.text}
                  className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-700 transition hover:-translate-y-0.5 hover:border-brand-500 hover:text-brand-700 hover:shadow-sm"
                  onClick={() => send(s.text)}
                >
                  <span aria-hidden className="text-base">{s.emoji}</span>
                  {s.text}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`flex animate-pop items-end gap-2 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            {m.role === "assistant" && <Mascot size={26} className="mb-0.5" />}
            <div className={`max-w-[85%] whitespace-pre-wrap break-words px-3.5 py-2 text-sm leading-relaxed ${m.role === "user" ? "rounded-2xl rounded-br-md bg-brand-600 text-white" : "rounded-2xl rounded-bl-md bg-brand-50 text-slate-900"}`}>
              {m.pending ? (
                <span className="flex items-center gap-2 text-slate-500">
                  <span className="typing-dots text-brand-500" aria-hidden><span /><span /><span /></span>
                  {activity ?? "Thinking…"}
                </span>
              ) : (
                <Linkified text={m.content} />
              )}
              {m.role === "assistant" && !m.pending && (
                <button className="ml-2 align-middle text-xs opacity-50 hover:opacity-100" onClick={() => say(m.content)} title="Read aloud" aria-label="Read aloud">🔊</button>
              )}
            </div>
          </div>
        ))}
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
              disabled={busy}
            >
              🎤
            </button>
            <button type="button" className="text-[10px] font-medium uppercase tracking-wide text-slate-500 hover:text-brand-600" onClick={() => setLang(lang === "ro-RO" ? "en-GB" : "ro-RO")} title="Voice language">
              {lang === "ro-RO" ? "RO" : "EN"}
            </button>
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
          placeholder={listening ? "Listening… 👂" : "Ask Poli…"}
          aria-label="Message"
        />
        <button className="btn-primary h-10 rounded-full px-4" disabled={busy || !input.trim()} aria-label="Send">Send ➤</button>
      </form>
      {!voiceSupported && <p className="px-4 pb-2 text-[11px] text-slate-400">Voice input needs a browser with speech recognition (Chrome, Edge or Safari).</p>}
    </section>
  );
}
