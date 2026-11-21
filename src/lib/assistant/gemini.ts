import "server-only";
import { GoogleGenAI, type Content, type FunctionDeclaration, type GenerateContentConfig, type Part } from "@google/genai";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { chatMessages } from "@/db/schema";
import { assistant } from "@/i18n/messages/assistant";
import type { User } from "../auth";
import { parseChoices, parsePreview } from "./choices";
import { parseReplyCard } from "./reply-card";
import { SYSTEM_PROMPT, contextLine, type AssistantChunk } from "./prompt";
import { modelText } from "./toolkit";
import { TOOLS, runTool, type ToolContext } from "./tools";

/**
 * Gemini-backed assistant. This app runs the tool loop itself: each request sends the
 * recent conversation, Gemini asks for tools, the handlers in `tools.ts` answer from the
 * local database, and the loop ends when Gemini replies in text.
 */

/**
 * Chosen by running the assistant's own planning and rescheduling questions on each model
 * this key can use: gemini-4-hydrogen called the right tools and answered fastest.
 */
export function geminiModel(): string {
  return process.env.GEMINI_MODEL || "gemini-4-hydrogen";
}

export function geminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

/** Most model requests one question may take (each tool round is one). */
const MAX_STEPS = 10;
/** How many earlier chat messages are sent along as context. */
const HISTORY_MESSAGES = 20;

const declarations: FunctionDeclaration[] = TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  parametersJsonSchema: t.input_schema,
}));

const config: GenerateContentConfig = {
  systemInstruction: SYSTEM_PROMPT,
  tools: [{ functionDeclarations: declarations }],
};

/**
 * Earlier turns from the chat log, oldest first, as plain text. The buttons offered
 * with a reply are spelled out, so a tapped answer ("Tuesday 18:00 works") makes sense.
 * The message being answered now is left out; the caller adds it with its context line.
 */
export function historyFor(userId: string, current: string, limit = HISTORY_MESSAGES): Content[] {
  const rows = getDb()
    .select({ role: chatMessages.role, content: chatMessages.content, choices: chatMessages.choices, preview: chatMessages.preview, card: chatMessages.card })
    .from(chatMessages)
    .where(eq(chatMessages.userId, userId))
    .orderBy(desc(chatMessages.id))
    .limit(limit + 1)
    .all()
    .reverse();
  const last = rows.at(-1);
  if (last?.role === "user" && last.content === current) rows.pop();
  // A follow-up like “where is the second one?” can refer to a row absent from the prose.
  const latestCard = rows.findLast((row) => row.role === "assistant" && row.card);

  const contents: Content[] = [];
  for (const row of rows) {
    const choices = parseChoices(row.choices);
    const preview = parsePreview(row.preview);
    let text = row.content;
    if (row === latestCard) {
      const card = parseReplyCard(row.card);
      if (card) text += `\n[Lookup shown with this reply, as it was at the time: ${JSON.stringify(card)}]`;
    }
    if (choices) text += `\n[Buttons shown: ${choices.map((c) => `${JSON.stringify(modelText(c.label, 80))} sends ${JSON.stringify(modelText(c.reply, 300))}`).join("; ")}]`;
    if (preview) {
      const title = JSON.stringify(modelText(preview.title, 120));
      const change = preview.action === "add" ? `add ${title}` : `move ${title} from ${preview.from?.date} ${preview.from?.start}–${preview.from?.end}`;
      text += `\n[Preview shown: ${change} to ${preview.weekly ? "every week from " : ""}${preview.date} ${preview.start}–${preview.end}; ${preview.status === "accepted" ? "the student accepted it and it is saved" : "not accepted yet"}]`;
    }
    const role = row.role === "assistant" ? "model" : "user";
    const previous = contents.at(-1);
    // Turns must alternate; merge any run of same-role messages.
    if (previous?.role === role) previous.parts!.push({ text });
    else contents.push({ role, parts: [{ text }] });
  }
  while (contents[0]?.role === "model") contents.shift();
  return contents;
}

/** The tool result in the shape Gemini expects: `output`, or `error` when the tool failed. */
function functionResponse(id: string | undefined, name: string, result: unknown): Part {
  const failed = !!result && typeof result === "object" && "error" in result;
  return { functionResponse: { id, name, response: failed ? { error: result } : { output: result } } };
}

type GeminiClient = Pick<GoogleGenAI, "models">;

/** A bounded wait: an overloaded model fails within a minute instead of retrying for several. */
function defaultClient(): GeminiClient {
  return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, httpOptions: { timeout: 60_000, retryOptions: { attempts: 2 } } });
}

const TRANSCRIBE_PROMPT =
  "Transcribe exactly what the speaker says, in the language they speak (usually Romanian or English). Do not translate it and do not answer it. Reply with the transcript only, or with nothing if there is no speech.";

/**
 * Speech to text for the voice button. Browsers' own recognition depends on a
 * Google service that Brave, VPNs and some networks block, so the recording is
 * transcribed here instead, the same way in every browser.
 */
export async function transcribeAudio(audio: Buffer, mimeType: string, client: GeminiClient = defaultClient()): Promise<string> {
  const response = await client.models.generateContent({
    model: geminiModel(),
    contents: [{ role: "user", parts: [{ inlineData: { mimeType, data: audio.toString("base64") } }, { text: TRANSCRIBE_PROMPT }] }],
  });
  return (response.candidates?.[0]?.content?.parts ?? [])
    .filter((p) => p.text && !p.thought)
    .map((p) => p.text)
    .join("")
    .trim();
}

/** Sends one student message and yields the reply, running tools as Gemini asks for them. */
export async function* askGemini(
  user: User,
  message: string,
  ctx: ToolContext,
  spoken = false,
  client: GeminiClient = defaultClient(),
): AsyncGenerator<AssistantChunk> {
  const contents: Content[] = [
    ...historyFor(user.id, message),
    { role: "user", parts: [{ text: `${contextLine(user, ctx, spoken)}\n${message}` }] },
  ];

  const t = assistant[ctx.locale ?? "en"].api;
  // Whether the student already has an answer: Gemini often replies and shows buttons in
  // one turn, then has nothing to add once the buttons are acknowledged.
  let answered = false;
  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await client.models.generateContent({ model: geminiModel(), contents, config });
    const candidate = response.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    const text = parts
      .filter((p) => p.text && !p.thought)
      .map((p) => p.text)
      .join("")
      .trim();
    if (text) {
      answered = true;
      yield { type: "text", text };
    }

    const calls = parts.flatMap((p) => (p.functionCall?.name ? [p.functionCall] : []));
    if (!calls.length) {
      if (!answered) {
        ctx.card = undefined;
        const reason = response.promptFeedback?.blockReason ?? candidate?.finishReason ?? "no answer";
        yield { type: "text", text: t.stopped(String(reason).toLowerCase()) };
      }
      return;
    }

    // Keep Gemini's own turn exactly as returned, so its thought signatures stay valid.
    contents.push(candidate!.content!);
    const results: Part[] = [];
    for (const call of calls) {
      yield { type: "tool", name: call.name! };
      results.push(functionResponse(call.id, call.name!, await runTool(call.name!, call.args ?? {}, ctx)));
    }
    contents.push({ role: "user", parts: results });
  }
  ctx.card = undefined;
  yield { type: "text", text: t.tooManySteps };
}
