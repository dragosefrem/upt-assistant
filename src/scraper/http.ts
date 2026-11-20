/**
 * Minimal HTTP client for the scraper.
 *
 * Node's fetch drops cookies between redirect hops, but SharePoint share links only
 * hand out the file after setting an auth cookie on the first 302 — so redirects are
 * followed by hand with a small per-call cookie jar.
 */

export interface Fetched {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string;
  body: Buffer;
}

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 UPT-Schedule-Importer/1.0";

export class HttpError extends Error {
  constructor(
    message: string,
    readonly url: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

function storeCookies(jar: Map<string, string>, res: Response) {
  for (const line of res.headers.getSetCookie()) {
    const pair = line.split(";", 1)[0];
    const eq = pair.indexOf("=");
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}

export async function fetchUrl(
  url: string,
  opts: { timeoutMs?: number; maxRedirects?: number; retries?: number } = {},
): Promise<Fetched> {
  const { timeoutMs = 45_000, maxRedirects = 8, retries = 1 } = opts;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetchOnce(url, timeoutMs, maxRedirects);
    } catch (err) {
      lastError = err;
      // 4xx responses will not improve on retry.
      if (err instanceof HttpError && err.status && err.status < 500) break;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function fetchOnce(url: string, timeoutMs: number, maxRedirects: number): Promise<Fetched> {
  // One host can serve cookies for another during an SSO-style hop, so the jar is
  // keyed by host and only ever sent back to the host that set it.
  const jars = new Map<string, Map<string, string>>();
  let current = url;
  const deadline = AbortSignal.timeout(timeoutMs);

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const host = new URL(current).host;
    const jar = jars.get(host) ?? new Map<string, string>();
    jars.set(host, jar);
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

    let res: Response;
    try {
      res = await fetch(current, {
        redirect: "manual",
        signal: deadline,
        headers: {
          "user-agent": USER_AGENT,
          accept: "*/*",
          "accept-language": "ro,en;q=0.8",
          ...(cookie ? { cookie } : {}),
        },
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new HttpError(`Request failed: ${reason}`, current);
    }
    storeCookies(jar, res);

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      await res.body?.cancel();
      if (!location) throw new HttpError(`Redirect without a location`, current, res.status);
      current = new URL(location, current).toString();
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new HttpError(`HTTP ${res.status}`, current, res.status);
    }
    return {
      url,
      finalUrl: current,
      status: res.status,
      contentType: (res.headers.get("content-type") ?? "").toLowerCase(),
      body: Buffer.from(await res.arrayBuffer()),
    };
  }
  throw new HttpError(`Too many redirects`, url);
}

export async function fetchText(url: string): Promise<{ text: string; finalUrl: string }> {
  const res = await fetchUrl(url);
  return { text: res.body.toString("utf8"), finalUrl: res.finalUrl };
}
