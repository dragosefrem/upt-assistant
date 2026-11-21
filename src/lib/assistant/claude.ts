import "server-only";
import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import type { User } from "../auth";
import { getSetting, setSetting } from "../settings";
import { SYSTEM_PROMPT as SYSTEM, contextLine, type AssistantChunk } from "./prompt";
import { TOOLS, runTool, type ToolContext } from "./tools";

/**
 * Claude-backed assistant on Claude Managed Agents.
 *
 * Anthropic hosts the agent loop; this app only defines the agent once, opens a
 * session per student and answers the agent's custom tool calls with data from our own
 * database. The agent has no sandbox tools: everything it can do is in `tools.ts`.
 */

const MODEL = "claude-opus-5-5";

export function claudeConfigured(): boolean {
  return Boolean(
    process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE,
  );
}

interface AgentRef {
  environmentId: string;
  agentId: string;
  version: number;
  hash: string;
}

const AGENT_KEY = "assistant.agent";
let provisioning: Promise<AgentRef> | null = null;

function agentTools() {
  return TOOLS.map((t) => ({
    type: "custom" as const,
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));
}

/**
 * Creates the environment and agent on first use and stores their ids; afterwards
 * only updates the agent when its prompt or tools have changed in code.
 */
export function ensureAgent(client: Anthropic): Promise<AgentRef> {
  provisioning ??= (async () => {
    const hash = createHash("sha1").update(JSON.stringify([MODEL, SYSTEM, agentTools()])).digest("hex");
    const stored = getSetting(AGENT_KEY);
    let ref = stored ? (JSON.parse(stored) as AgentRef) : null;
    if (ref && ref.hash === hash) return ref;

    if (!ref) {
      const environment = await client.beta.environments.create({
        name: "upt-assistant",
        config: {
          type: "cloud",
          // The agent only talks to this app through custom tools; it needs no network.
          networking: { type: "limited", allow_package_managers: false, allow_mcp_servers: false },
        },
      });
      const agent = await client.beta.agents.create({
        name: "Poli",
        model: MODEL,
        system: SYSTEM,
        tools: agentTools(),
      });
      ref = { environmentId: environment.id, agentId: agent.id, version: agent.version, hash };
    } else {
      const agent = await client.beta.agents.update(ref.agentId, { model: MODEL, system: SYSTEM, tools: agentTools() });
      ref = { ...ref, version: agent.version, hash };
    }
    setSetting(AGENT_KEY, JSON.stringify(ref));
    return ref;
  })().finally(() => {
    provisioning = null;
  });
  return provisioning;
}

async function openSession(client: Anthropic, user: User, ref: AgentRef): Promise<string> {
  const key = `assistant.session.${user.id}`;
  const stored = getSetting(key);
  if (stored) {
    const [version, id] = stored.split("|");
    // A session stays pinned to the agent version it started with.
    if (+version === ref.version && id) return id;
  }
  const session = await client.beta.sessions.create({
    agent: { type: "agent", id: ref.agentId, version: ref.version },
    environment_id: ref.environmentId,
    title: "Poli",
  });
  setSetting(key, `${ref.version}|${session.id}`);
  return session.id;
}

export function forgetSession(user: User) {
  setSetting(`assistant.session.${user.id}`, null);
}

/** Sends one student message and yields the agent's reply as it is produced. */
export async function* askClaude(user: User, message: string, ctx: ToolContext, spoken = false): AsyncGenerator<AssistantChunk> {
  const client = new Anthropic();
  const ref = await ensureAgent(client);
  const sessionId = await openSession(client, user, ref);

  // Open the stream before sending so no early event is missed.
  const stream = await client.beta.sessions.events.stream(sessionId);
  await client.beta.sessions.events.send(sessionId, {
    events: [{ type: "user.message", content: [{ type: "text", text: `${contextLine(user, ctx, spoken)}\n${message}` }] }],
  });

  for await (const event of stream) {
    if (event.type === "agent.message") {
      for (const block of event.content) {
        if (block.type === "text" && block.text) yield { type: "text", text: block.text };
      }
    } else if (event.type === "agent.custom_tool_use") {
      yield { type: "tool", name: event.name };
      const result = await runTool(event.name, event.input, ctx);
      await client.beta.sessions.events.send(sessionId, {
        events: [
          {
            type: "user.custom_tool_result",
            custom_tool_use_id: event.id,
            content: [{ type: "text", text: JSON.stringify(result) }],
          },
        ],
      });
    } else if (event.type === "session.status_idle") {
      // "requires_action" means the agent is waiting for the tool result sent above.
      if (event.stop_reason.type !== "requires_action") return;
    } else if (event.type === "session.status_terminated") {
      forgetSession(user);
      return;
    }
  }
}
