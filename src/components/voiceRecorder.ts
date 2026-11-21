/**
 * Records one spoken question with the microphone, for transcription on the server.
 * It stops by itself once the speaker pauses, so asking works hands-free like the
 * browser's own speech recognition did, but without depending on it.
 */

export type StopReason = "stopped" | "silence" | "no-speech" | "limit";

export interface Recording {
  /** Stops and delivers what was recorded. */
  stop(): void;
  /** Stops and discards the recording. */
  cancel(): void;
  /** False when the browser kept audio analysis suspended, so the student must tap to stop. */
  autoStops: boolean;
}

export function recorderSupported(): boolean {
  return typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
}

// Chrome, Edge, Brave and Firefox record WebM/Opus; Safari records MP4.
const TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
/** Loudness (RMS of the waveform) above which the microphone is taken to hear speech. */
const SPEECH_LEVEL = 0.02;

export async function startRecording(
  onDone: (audio: Blob | null, reason: StopReason) => void,
  opts: { silenceMs?: number; noSpeechMs?: number; maxMs?: number } = {},
): Promise<Recording> {
  const { silenceMs = 1500, noSpeechMs = 8000, maxMs = 30_000 } = opts;
  // Throws NotAllowedError (permission) or NotFoundError (no microphone) for the caller to explain.
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  const mimeType = TYPES.find((t) => MediaRecorder.isTypeSupported(t));
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };

  // Watch the loudness to notice when the question is over.
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const audio = new Ctx();
  await audio.resume().catch(() => {});
  const autoStops = audio.state === "running";
  const analyser = audio.createAnalyser();
  analyser.fftSize = 1024;
  audio.createMediaStreamSource(stream).connect(analyser);
  const samples = new Float32Array(analyser.fftSize);

  const started = Date.now();
  let spoke = false;
  let lastSpeech = started;
  let reason: StopReason = "stopped";
  let cancelled = false;
  let finished = false;

  const finish = (why: StopReason) => {
    if (finished) return;
    finished = true;
    reason = why;
    clearInterval(timer);
    if (recorder.state !== "inactive") recorder.stop();
  };

  const timer = setInterval(() => {
    const now = Date.now();
    if (autoStops) {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const s of samples) sum += s * s;
      if (Math.sqrt(sum / samples.length) > SPEECH_LEVEL) {
        spoke = true;
        lastSpeech = now;
      }
      if (spoke && now - lastSpeech > silenceMs) return finish("silence");
      if (!spoke && now - started > noSpeechMs) return finish("no-speech");
    }
    if (now - started > maxMs) finish("limit");
  }, 100);

  recorder.onstop = () => {
    clearInterval(timer);
    stream.getTracks().forEach((t) => t.stop());
    void audio.close().catch(() => {});
    if (cancelled) return;
    const blob = chunks.length ? new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" }) : null;
    onDone(reason === "no-speech" ? null : blob, reason);
  };
  recorder.start(250);

  return {
    stop: () => finish("stopped"),
    cancel: () => {
      cancelled = true;
      finish("stopped");
    },
    autoStops,
  };
}
