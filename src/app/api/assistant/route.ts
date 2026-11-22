import Anthropic from "@anthropic-ai/sdk";
import { ApiError as GeminiApiError } from "@google/genai";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { chatMessages } from "@/db/schema";
import { checklistIds } from "@/lib/guide-checklist";
import { getUser } from "@/lib/auth";
import { getLocale, getT } from "@/i18n/server";
import type { Messages } from "@/i18n/messages";
import { parseChoices, parseLinks, parsePreview, publicPreview } from "@/lib/assistant/choices";
import { eventEditorTime, optionIndex } from "@/lib/assistant/selection";
import { askClaude, claudeConfigured, forgetSession } from "@/lib/assistant/claude";
import { askGemini, geminiConfigured } from "@/lib/assistant/gemini";
import { askLocal } from "@/lib/assistant/local";
import { acceptPreview } from "@/lib/assistant/accept";
import { latestMessage, reviewTime } from "@/lib/assistant/preview";
import type { AssistantChunk } from "@/lib/assistant/prompt";
import { parseReplyCard } from "@/lib/assistant/reply-card";
import type { ToolContext } from "@/lib/assistant/tools";

type Engine = "gemini" | "claude" | "basic";

/** Gemini when its key is set, else Claude when configured, else the built-in keyword assistant. */
function activeEngine(): Engine {
  return geminiConfigured() ? "gemini" : claudeConfigured() ? "claude" : "basic";
}

function completedReply(text: string, details: Record<string, unknown>) {
  const lines = [{ type: "text", text }, { type: "done", engine: activeEngine(), ...details }];
  return new Response(lines.map((line) => JSON.stringify(line) + "\n").join(""), { headers: {
    "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store",
  } });
}

/** A short explanation of why the AI engine failed, shown above the built-in assistant's answer. */
function failureNotice(engine: Engine, err: unknown, t: Messages["assistant"]["api"]): string {
  if (engine === "gemini") {
    if (err instanceof GeminiApiError) {
      if (err.status === 400 && /api key/i.test(err.message)) return t.geminiKey;
      if (err.status === 401 || err.status === 403) return t.geminiKey;
      if (err.status === 429) return t.geminiQuota;
      if (err.status === 404) return t.geminiModel;
      return t.geminiError(err.status);
    }
    return t.geminiUnreachable;
  }
  if (err instanceof Anthropic.AuthenticationError) return t.claudeKey;
  if (err instanceof Anthropic.RateLimitError) return t.claudeLimit;
  if (err instanceof Anthropic.APIError) return t.claudeError(String(err.status ?? "network"));
  return t.claudeUnreachable;
}

/**
 * Chat endpoint. Streams newline-delimited JSON:
 *   {"type":"tool","name":…}  the assistant is looking something up
 *   {"type":"text","text":…}  a piece of the reply
 *   {"type":"done","engine":"gemini"|"claude"|"basic","changed":bool,"choices"?:[…],"links"?:[…],
 *    "card"?:{…},"open"?:"/path","locale"?:"ro"|"en","notice"?:…}
 * `choices` are tappable options (time slots, "Yes, add it") to show under the reply, `links`
 * buttons that open a page of the app. `open` asks the browser to go to a page and `locale`
 * to switch the interface language, when the student asked the assistant for that.
 */
export async function POST(request: Request) {
  const tr = (await getT()).assistant;
  const t = tr.api;
  const user = await getUser();
  if (!user) return Response.json({ error: t.notSignedIn }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    message?: unknown;
    spoken?: unknown;
    choiceMessageId?: unknown;
    checklist?: unknown;
    location?: { lat?: unknown; lng?: unknown };
  } | null;
  const message = typeof body?.message === "string" ? body.message.trim().slice(0, 2000) : "";
  if (!message) return Response.json({ error: t.emptyMessage }, { status: 400 });
  const spoken = body?.spoken === true;
  const lat = Number(body?.location?.lat);
  const lng = Number(body?.location?.lng);
  const locale = await getLocale();
  const ctx: ToolContext = {
    user,
    origin: new URL(request.url).origin,
    checklist: Array.isArray(body?.checklist) ? checklistIds(body.checklist) : undefined,
    location: Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null,
    changed: false,
    locale,
  };

  const db = getDb();
  const last = latestMessage(user.id);
  const index = body?.choiceMessageId === undefined ? optionIndex(message) : undefined;
  let pickedEvent: string | undefined;
  if (index !== undefined) {
    if (last?.role === "assistant") {
      ctx.pickedReply = parseChoices(last.choices)?.[index]?.reply;
      const card = parseReplyCard(last.card);
      const row = card?.type === "move" ? card.events[index] : undefined;
      if (card?.type === "move" && row) {
        const time = eventEditorTime(row, card.proposed);
        if (row.move.scope !== "choose" && time.end > time.start && (time.date !== row.date || time.start !== row.start || time.end !== row.end)) {
          const result = reviewTime(user, { ...time, id: last.id, occurrence: row.move.occurrence }, locale, message);
          if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
          return completedReply(result.reply, { changed: false, preview: result.preview, messageId: result.id });
        }
        ctx.card = { ...card, events: [row], count: 1 };
        pickedEvent = tr.preview.pickTime(row.title, row.start);
      }
    }
  }
  if (body?.choiceMessageId !== undefined) {
    if (last?.role !== "assistant" || last.id !== body.choiceMessageId || !parseChoices(last.choices)?.some((c) => c.reply === message)) {
      return Response.json({ error: t.staleChoice }, { status: 409 });
    }
  }
  // A short spoken or typed confirmation accepts the same stored proposal as its button.
  if (/^(?:yes|accept|confirm|save it|yes,? (?:please|move it|save it)|da|acceptă|confirmă|da,? (?:te rog|mută-l|salvează))[.!\s]*$/iu.test(message)) {
    if (last?.role === "assistant" && parsePreview(last.preview)?.status === "pending") {
      const saved = acceptPreview(user, last.id, ctx.locale, message);
      if (!saved.ok) return Response.json({ error: saved.error }, { status: saved.status });
      return completedReply(saved.reply, { changed: true, acceptedId: last.id });
    }
  }
  const turn = db.insert(chatMessages).values({ userId: user.id, role: "user", content: message }).returning({ id: chatMessages.id }).get();
  ctx.confirmPreview = (proposal) => {
    if (last?.role !== "assistant" || !last.preview) return;
    const saved = acceptPreview(user, last.id, locale, message, { userMessageId: turn.id, proposal });
    if (saved.ok) { ctx.acceptedId = last.id; return saved.reply; }
  };

  const encoder = new TextEncoder();
  // The student may reload or close the page while Poli is answering. The turn is already
  // under way (and paid for, and its tools may have acted), so it is finished and saved
  // whoever is still listening: the answer is in the conversation when they come back.
  let listening = true;
  const stream = new ReadableStream({
    cancel() {
      listening = false;
    },
    async start(controller) {
      const send = (obj: unknown) => {
        if (!listening) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
        } catch {
          listening = false;
        }
      };
      let reply = "";
      let engine: Engine = "basic";
      let notice: string | undefined;

      const ai = activeEngine();
      if (pickedEvent) {
        reply = pickedEvent;
        engine = ai;
        send({ type: "text", text: reply });
      } else if (ai !== "basic") {
        try {
          const chunks: AsyncGenerator<AssistantChunk> = ai === "gemini" ? askGemini(user, message, ctx, spoken) : askClaude(user, message, ctx, spoken);
          for await (const chunk of chunks) {
            if (chunk.type === "text") reply += (reply ? "\n\n" : "") + chunk.text;
            send(chunk);
          }
          engine = ai;
        } catch (err) {
          ctx.card = undefined;
          ctx.choices = undefined;
          ctx.preview = undefined;
          // Claude: start a fresh session next time; a stale one is the usual cause.
          if (ai === "claude") forgetSession(user);
          console.error(`Assistant: ${ai} request failed`, err);
          notice = failureNotice(ai, err, t);
        }
      }
      if (engine === "basic" && !reply) {
        reply = ctx.savedReply ?? askLocal(ctx.pickedReply ?? message, ctx);
        if (ctx.card) ctx.card.textIsTranscript = true;
        send({ type: "text", text: reply });
      }
      // Choices and previews only make sense next to the reply that offered them.
      const preview = reply ? ctx.preview : undefined;
      const choices = reply && !preview ? ctx.choices : undefined;
      const links = engine !== "basic" && reply && ctx.links?.length ? ctx.links : undefined;
      const card = reply && !preview && !choices && !ctx.changed ? ctx.card : undefined;

      const saved = reply
        ? db
            .insert(chatMessages)
            .values({
              userId: user.id,
              role: "assistant",
              content: reply,
              choices: choices ? JSON.stringify(choices) : null,
              preview: preview ? JSON.stringify(preview) : null,
              links: links ? JSON.stringify(links) : null,
              card: card ? JSON.stringify(card) : null,
            })
            .returning({ id: chatMessages.id })
            .get()
        : undefined;
      send({
        type: "done",
        engine,
        changed: ctx.changed,
        acceptedId: ctx.acceptedId,
        messageId: saved?.id,
        choices,
        preview: publicPreview(preview),
        links,
        card,
        open: reply ? ctx.open : undefined,
        locale: ctx.setLocale,
        checklistEdits: ctx.checklistEdits,
        notice,
      });
      if (listening) {
        try {
          controller.close();
        } catch {
          // The browser went away between the last line and the end of the stream.
        }
      }
    },
  });
  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}

/** Recent conversation, oldest first. */
export async function GET() {
  const user = await getUser();
  if (!user) return Response.json({ error: (await getT()).assistant.api.notSignedIn }, { status: 401 });
  const rows = getDb()
    .select({ id: chatMessages.id, role: chatMessages.role, content: chatMessages.content, choices: chatMessages.choices, preview: chatMessages.preview, links: chatMessages.links, card: chatMessages.card })
    .from(chatMessages)
    .where(eq(chatMessages.userId, user.id))
    .orderBy(desc(chatMessages.id))
    .limit(30)
    .all()
    .reverse()
    .map((m) => ({ ...m, choices: parseChoices(m.choices), preview: publicPreview(parsePreview(m.preview)), links: parseLinks(m.links), card: parseReplyCard(m.card) }));
  return Response.json({ messages: rows, engine: activeEngine() });
}

export async function DELETE() {
  const user = await getUser();
  if (!user) return Response.json({ error: (await getT()).assistant.api.notSignedIn }, { status: 401 });
  getDb().delete(chatMessages).where(and(eq(chatMessages.userId, user.id))).run();
  forgetSession(user);
  return Response.json({ ok: true });
}
