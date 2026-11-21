import { ApiError } from "@google/genai";
import { geminiConfigured, transcribeAudio } from "@/lib/assistant/gemini";
import { getUser } from "@/lib/auth";

/** Formats browsers record in (Chrome/Edge/Brave/Firefox: WebM or Ogg; Safari: MP4), plus WAV. */
const AUDIO_TYPES = new Set(["audio/webm", "audio/ogg", "audio/mp4", "audio/x-m4a", "audio/aac", "audio/mpeg", "audio/wav"]);
/** About five minutes of compressed speech; a question takes a few seconds. */
const MAX_BYTES = 5 * 1024 * 1024;

/** Transcribes a voice recording from the chat. Body: the audio itself, with its content type. */
export async function POST(request: Request) {
  const user = await getUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  if (!geminiConfigured()) return Response.json({ error: "Voice transcription needs a Gemini API key." }, { status: 503 });

  const type = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!AUDIO_TYPES.has(type)) return Response.json({ error: `Unsupported audio format (${type || "none"}).` }, { status: 415 });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BYTES) return Response.json({ error: "The recording is too long." }, { status: 413 });
  const audio = Buffer.from(await request.arrayBuffer());
  if (!audio.length) return Response.json({ error: "The recording is empty." }, { status: 400 });
  if (audio.length > MAX_BYTES) return Response.json({ error: "The recording is too long." }, { status: 413 });

  try {
    return Response.json({ text: await transcribeAudio(audio, type) });
  } catch (err) {
    console.error("Voice transcription failed", err);
    const status = err instanceof ApiError ? err.status : 502;
    return Response.json(
      { error: status === 429 ? "Gemini's quota is used up for now; please type your question." : "The recording could not be transcribed. Please try again." },
      { status: 502 },
    );
  }
}
