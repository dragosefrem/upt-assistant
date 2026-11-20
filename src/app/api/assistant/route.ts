import Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { chatMessages } from "@/db/schema";
import { getUser } from "@/lib/auth";
import { askClaude, claudeConfigured, forgetSession } from "@/lib/assistant/claude";
import { askLocal } from "@/lib/assistant/local";
import type { ToolContext } from "@/lib/assistant/tools";

/**
 * Chat endpoint. Streams newline-delimited JSON:
 *   {"type":"tool","name":…}  the assistant is looking something up
 *   {"type":"text","text":…}  a piece of the reply
 *   {"type":"done","engine":"claude"|"basic","changed":bool,"notice"?:…}
 */
export async function POST(request: Request) {
  const user = await getUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { message?: unknown; location?: { lat?: unknown; lng?: unknown } } | null;
  const message = typeof body?.message === "string" ? body.message.trim().slice(0, 2000) : "";
  if (!message) return Response.json({ error: "Empty message" }, { status: 400 });
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
      let engine: "claude" | "basic" = "basic";
      let notice: string | undefined;

      if (claudeConfigured()) {
        try {
          for await (const chunk of askClaude(user, message, ctx)) {
            if (chunk.type === "text") reply += (reply ? "\n\n" : "") + chunk.text;
            send(chunk);
          }
          engine = "claude";
        } catch (err) {
          // Start a fresh session next time; a stale one is the usual cause.
          forgetSession(user);
          console.error("Assistant: Claude request failed", err);
          if (err instanceof Anthropic.AuthenticationError) notice = "Claude credentials were rejected; using the built-in assistant.";
          else if (err instanceof Anthropic.RateLimitError) notice = "Claude is rate-limited right now; using the built-in assistant.";
          else if (err instanceof Anthropic.APIError) notice = `Claude returned an error (${err.status ?? "network"}); using the built-in assistant.`;
          else notice = "Claude could not be reached; using the built-in assistant.";
        }
      }
      if (engine === "basic" && !reply) {
        reply = askLocal(message, ctx);
        send({ type: "text", text: reply });
      }

      if (reply) db.insert(chatMessages).values({ userId: user.id, role: "assistant", content: reply }).run();
      send({ type: "done", engine, changed: ctx.changed, notice });
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
    .select({ id: chatMessages.id, role: chatMessages.role, content: chatMessages.content })
    .from(chatMessages)
    .where(eq(chatMessages.userId, user.id))
    .orderBy(desc(chatMessages.id))
    .limit(30)
    .all()
    .reverse();
  return Response.json({ messages: rows, engine: claudeConfigured() ? "claude" : "basic" });
}

export async function DELETE() {
  const user = await getUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  getDb().delete(chatMessages).where(and(eq(chatMessages.userId, user.id))).run();
  forgetSession(user);
  return Response.json({ ok: true });
}
