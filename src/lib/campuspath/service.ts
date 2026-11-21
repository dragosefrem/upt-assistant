import "server-only";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Finds or starts the Campuspath service (services/campuspath, a Python/Flask app).
 *
 * With CAMPUSPATH_URL set, that service is used as it is. Otherwise this Node process starts
 * `python app.py --host 127.0.0.1 --port <CAMPUSPATH_PORT>` on first use and keeps it running
 * until Node exits. A Campuspath that already answers on the port is reused. The state lives on
 * `globalThis` so that hot reloads in development do not start a second copy.
 */

export type UnavailableReason = "missing" | "port" | "crashed" | "timeout" | "unreachable";

/** The service cannot be reached or started. Callers answer 503 with a translated message. */
export class CampuspathUnavailable extends Error {
  constructor(
    readonly reason: UnavailableReason,
    detail: string,
  ) {
    super(`Campuspath is unavailable (${reason}): ${detail}`);
    this.name = "CampuspathUnavailable";
  }
}

export interface CampuspathConfig {
  /** An external service to use as it is. */
  url: string | null;
  port: number;
  python: string;
  dir: string;
  startTimeoutMs: number;
}

export const DEFAULT_PORT = 8765;

/** Where the service is or how to start it, from the environment. */
export function campuspathConfig(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): CampuspathConfig {
  const dir = env.CAMPUSPATH_DIR || path.join(cwd, "services", "campuspath");
  const port = Number(env.CAMPUSPATH_PORT);
  const venv = path.join(dir, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  const timeout = Number(env.CAMPUSPATH_START_TIMEOUT_MS);
  return {
    url: env.CAMPUSPATH_URL?.trim().replace(/\/+$/, "") || null,
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULT_PORT,
    python: env.CAMPUSPATH_PYTHON || (existsSync(venv) ? venv : "python3"),
    dir,
    startTimeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 45_000,
  };
}

/** Seconds to wait after a failed start before trying again, so a broken install is not spawned in a loop. */
const BACK_OFF_MS = 15_000;
const PROBE_TIMEOUT_MS = 2_000;

interface ManagerState {
  child: ChildProcess | null;
  /** Base URL of a service known to answer. */
  base: string | null;
  starting: Promise<string> | null;
  failure: CampuspathUnavailable | null;
  failedAt: number;
  exitHook: boolean;
  /** The last lines the child wrote, for the server log when it fails. */
  log: string;
}

const globalState = globalThis as typeof globalThis & { __campuspath?: ManagerState };
const state: ManagerState = (globalState.__campuspath ??= {
  child: null,
  base: null,
  starting: null,
  failure: null,
  failedAt: 0,
  exitHook: false,
  log: "",
});

/**
 * Whether a Campuspath answers at `base`: "yes", "other" (something else holds the port) or
 * "none" (nothing listens). The building pins identify it: a JSON list of points with a `pin`.
 */
export async function probeCampuspath(base: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<"yes" | "other" | "none"> {
  let response: Response;
  try {
    response = await fetch(`${base}/api/checkpoints?pins=1`, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    return "none";
  }
  try {
    const body: unknown = await response.json();
    const looksRight = response.ok && Array.isArray(body) && body.length > 0 && body.every((p) => p && typeof p === "object" && "pin" in p);
    return looksRight ? "yes" : "other";
  } catch {
    return "other";
  }
}

function remember(chunk: Buffer) {
  state.log = (state.log + chunk.toString("utf8")).slice(-4000);
}

function fail(reason: UnavailableReason, detail: string): CampuspathUnavailable {
  const failure = new CampuspathUnavailable(reason, detail);
  state.failure = failure;
  state.failedAt = Date.now();
  state.base = null;
  console.warn(`[campuspath] ${failure.message}${state.log ? `\n${state.log.trim().split("\n").slice(-8).join("\n")}` : ""}`);
  return failure;
}

function hookExit() {
  if (state.exitHook) return;
  state.exitHook = true;
  // Only the child this process started is stopped; a reused service belongs to someone else.
  process.once("exit", () => {
    if (state.child && state.child.exitCode === null) state.child.kill();
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function start(config: CampuspathConfig): Promise<string> {
  const base = `http://127.0.0.1:${config.port}`;
  const found = await probeCampuspath(base);
  if (found === "yes") {
    state.failure = null;
    return base;
  }
  if (found === "other") throw fail("port", `port ${config.port} answers, but not as Campuspath. Set CAMPUSPATH_PORT to a free port.`);
  if (!existsSync(path.join(config.dir, "app.py"))) throw fail("missing", `${config.dir}/app.py was not found.`);

  state.log = "";
  // Set from the child's events while the loop below waits.
  const status: { exited: string | null } = { exited: null };
  const child = spawn(config.python, ["app.py", "--host", "127.0.0.1", "--port", String(config.port)], {
    cwd: config.dir,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
  });
  state.child = child;
  hookExit();
  child.stdout?.on("data", remember);
  child.stderr?.on("data", remember);
  child.on("error", (error) => {
    status.exited = `${config.python} could not be started (${error.message}).`;
  });
  child.on("exit", (code, signal) => {
    status.exited ??= `the service stopped (${signal ?? `exit code ${code}`}).`;
    if (state.child === child) {
      state.child = null;
      state.base = null;
    }
  });

  const deadline = Date.now() + config.startTimeoutMs;
  while (Date.now() < deadline) {
    await sleep(300);
    const exited = status.exited;
    if (exited) throw fail(/could not be started|No module named/.test(exited + state.log) ? "missing" : "crashed", exited);
    if ((await probeCampuspath(base)) === "yes") {
      state.failure = null;
      console.info(`[campuspath] started on ${base} with ${config.python} (pid ${child.pid})`);
      return base;
    }
  }
  child.kill();
  throw fail("timeout", `no answer on ${base} within ${Math.round(config.startTimeoutMs / 1000)} s.`);
}

/** The base URL of a running Campuspath, starting it if needed. Throws CampuspathUnavailable. */
export async function campuspathBase(config: CampuspathConfig = campuspathConfig()): Promise<string> {
  if (config.url) return config.url;
  const alive = !state.child || (state.child.exitCode === null && state.child.signalCode === null);
  if (state.base && alive) return state.base;
  if (state.starting) return state.starting;
  if (state.failure && Date.now() - state.failedAt < BACK_OFF_MS) throw state.failure;
  state.starting = start(config)
    .then((base) => (state.base = base))
    .finally(() => {
      state.starting = null;
    });
  return state.starting;
}

/** A request found the service gone: the next one starts it again. */
export function campuspathLost() {
  state.base = null;
}

/** Whether the service is started by this app (no CAMPUSPATH_URL). For the setup hint. */
export function managesCampuspath(config: CampuspathConfig = campuspathConfig()): boolean {
  return !config.url;
}
