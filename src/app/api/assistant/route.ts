import Anthropic from "@anthropic-ai/sdk";
import { ApiError as GeminiApiError } from "@google/genai";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { chatMessages } from "@/db/schema";
import { getUser } from "@/lib/auth";
import { parseChoices, parsePreview, publicPreview } from "@/lib/assistant/choices";
import { askClaude, claudeConfigured, forgetSession } from "@/lib/assistant/claude";
import { askGemini, geminiConfigured } from "@/lib/assistant/gemini";
import { askLocal } from "@/lib/assistant/local";
import type { AssistantChunk } from "@/lib/assistant/prompt";
import type { ToolContext } from "@/lib/assistant/tools";

type Engine = "gemini" | "claude" | "basic";

/** Gemini when its key is set, else Claude when configured, else the built-in keyword assistant. */
function activeEngine(): Engine {
  return geminiConfigured() ? "gemini" : claudeConfigured() ? "claude" : "basic";
}

/** A short explanation of why the AI engine failed, shown above the built-in assistant's answer. */
function failureNotice(engine: Engine, err: unknown): string {
  if (engine === "gemini") {
    if (err instanceof GeminiApiError) {
      if (err.status === 400 && /api key/i.test(err.message)) return "Gemini rejected the API key; using the built-in assistant.";
      if (err.status === 401 || err.status === 403) return "Gemini rejected the API key; using the built-in assistant.";
      if (err.status === 429) return "Gemini's rate limit or free quota is used up for now; using the built-in assistant.";
      if (err.status === 404) return "That Gemini model is not available to this key (check GEMINI_MODEL); using the built-in assistant.";
      return `Gemini returned an error (${err.status}); using the built-in assistant.`;
    }
    return "Gemini could not be reached; using the built-in assistant.";
  }
  if (err instanceof Anthropic.AuthenticationError) return "Claude credentials were rejected; using the built-in assistant.";
  if (err instanceof Anthropic.RateLimitError) return "Claude is rate-limited right now; using the built-in assistant.";
  if (err instanceof Anthropic.APIError) return `Claude returned an error (${err.status ?? "network"}); using the built-in assistant.`;
  return "Claude could not be reached; using the built-in assistant.";
}

/**
 * Chat endpoint. Streams newline-delimited JSON:
 *   {"type":"tool","name":…}  the assistant is looking something up
 *   {"type":"text","text":…}  a piece of the reply
 *   {"type":"done","engine":"gemini"|"claude"|"basic","changed":bool,"choices"?:[…],"notice"?:…}
 * `choices` are tappable options (time slots, "Yes, add it") to show under the reply.
 */
export async function POST(request: Request) {
  const user = await getUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    message?: unknown;
    spoken?: unknown;
    location?: { lat?: unknown; lng?: unknown };
  } | null;
  const message = typeof body?.message === "string" ? body.message.trim().slice(0, 2000) : "";
  if (!message) return Response.json({ error: "Empty message" }, { status: 400 });
  const spoken = body?.spoken === true;
  const lat = Number(body?.location?.lat);
  const lng = Number(body?.location?.lng);
  const ctx: ToolContext = {
    user,
    location: Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null,
    changed: false,
  };

  const db = getDb();
  db.insert(chatMessages).values({ userId: user.id, role: "user", content: message }).run();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
      let reply = "";
      let engine: Engine = "basic";
      let notice: string | undefined;

      const ai = activeEngine();
      if (ai !== "basic") {
        try {
          const chunks: AsyncGenerator<AssistantChunk> = ai === "gemini" ? askGemini(user, message, ctx, spoken) : askClaude(user, message, ctx, spoken);
          for await (const chunk of chunks) {
            if (chunk.type === "text") reply += (reply ? "\n\n" : "") + chunk.text;
            send(chunk);
          }
          engine = ai;
        } catch (err) {
          // Claude: start a fresh session next time; a stale one is the usual cause.
          if (ai === "claude") forgetSession(user);
          console.error(`Assistant: ${ai} request failed`, err);
          notice = failureNotice(ai, err);
        }
      }
      if (engine === "basic" && !reply) {
        reply = askLocal(message, ctx);
        send({ type: "text", text: reply });
      }
      // Choices and previews only make sense next to the reply that offered them.
      const choices = engine !== "basic" && reply ? ctx.choices : undefined;
      const preview = engine !== "basic" && reply ? ctx.preview : undefined;

      const saved = reply
        ? db
            .insert(chatMessages)
            .values({
              userId: user.id,
              role: "assistant",
              content: reply,
              choices: choices ? JSON.stringify(choices) : null,
              preview: preview ? JSON.stringify(preview) : null,
            })
            .returning({ id: chatMessages.id })
            .get()
        : undefined;
      send({ type: "done", engine, changed: ctx.changed, messageId: saved?.id, choices, preview: publicPreview(preview), notice });
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}

/** Recent conversation, oldest first. */
export async function GET() {
  const user = await getUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  const rows = getDb()
    .select({ id: chatMessages.id, role: chatMessages.role, content: chatMessages.content, choices: chatMessages.choices, preview: chatMessages.preview })
    .from(chatMessages)
    .where(eq(chatMessages.userId, user.id))
    .orderBy(desc(chatMessages.id))
    .limit(30)
    .all()
    .reverse()
    .map((m) => ({ ...m, choices: parseChoices(m.choices), preview: publicPreview(parsePreview(m.preview)) }));
  return Response.json({ messages: rows, engine: activeEngine() });
}

export async function DELETE() {
  const user = await getUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  getDb().delete(chatMessages).where(and(eq(chatMessages.userId, user.id))).run();
  forgetSession(user);
  return Response.json({ ok: true });
}
