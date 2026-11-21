import { eq } from "drizzle-orm";
import nodemailer from "nodemailer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db";
import { passwordResets, sessions, users } from "@/db/schema";
import { createUser, verifyPassword } from "@/lib/auth";
import { RESET_LIMIT, requestPasswordReset, resetBaseUrl, resetEmail, resetPassword, resetTarget } from "@/lib/password-reset";

const EMAIL = "ana@example.com";
const BASE = "https://orar.example.org";
const tokenIn = (text: string) => /\/reset\/([A-Za-z0-9_-]+)/.exec(text)![1];

function outbox() {
  const transport = nodemailer.createTransport({ jsonTransport: true });
  const send = vi.spyOn(transport, "sendMail");
  const jobs: Array<() => Promise<void>> = [];
  const defer = (job: () => Promise<void>) => { jobs.push(job); };
  const request = (email = EMAIL, baseUrl: string | null = BASE) => requestPasswordReset(email, baseUrl, "en", defer, transport);
  return { request, send, jobs, deliver: () => Promise.all(jobs.splice(0).map((job) => job())) };
}

describe("password reset", () => {
  let userId: string;
  let feedToken: string;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-23T08:00:00Z"));
    vi.stubEnv("DATABASE_PATH", ":memory:");
    getDb().delete(users).run();
    const user = createUser({ email: EMAIL, name: "Ana Popescu", password: "old-password-1", locale: "ro" });
    userId = user.id;
    feedToken = user.feedToken;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("defers all account-specific work and silently limits queued requests", async () => {
    const mail = outbox();
    for (let i = 0; i < RESET_LIMIT + 1; i++) expect(mail.request()).toBe("sent");
    expect(mail.request("unknown@example.com")).toBe("sent");
    expect(mail.jobs).toHaveLength(RESET_LIMIT + 2);
    expect(getDb().select().from(passwordResets).all()).toEqual([]);
    expect(mail.send).not.toHaveBeenCalled();
    await mail.deliver();
    expect(mail.send).toHaveBeenCalledTimes(RESET_LIMIT);
    expect(getDb().select().from(passwordResets).all()).toHaveLength(RESET_LIMIT);

    expect(mail.request()).toBe("sent");
    await mail.deliver();
    expect(mail.send).toHaveBeenCalledTimes(RESET_LIMIT);
    vi.setSystemTime(Date.now() + 60 * 60_000);
    expect(mail.request()).toBe("sent");
    await mail.deliver();
    expect(mail.send).toHaveBeenCalledTimes(RESET_LIMIT + 1);
  });

  it("delivers nothing for an unknown address, even in the background", async () => {
    const mail = outbox();
    expect(mail.request("unknown@example.com")).toBe("sent");
    await mail.deliver();
    expect(mail.send).not.toHaveBeenCalled();
    expect(getDb().select().from(passwordResets).all()).toEqual([]);
  });

  it("mails the configured URL in the account's language and stores only the token hash", async () => {
    vi.stubEnv("APP_URL", BASE + "/");
    const mail = outbox();
    mail.request("  ANA@example.com ", resetBaseUrl(new Headers({ host: "localhost:3100" })));
    await mail.deliver();
    const [message] = mail.send.mock.calls[0];
    expect(message.to).toBe(EMAIL);
    expect(message.subject).toBe("Resetează-ți parola Poli");
    expect(message.text).toContain("Salut, Ana,");
    const token = tokenIn(String(message.text));
    expect(message.text).toContain(`${BASE}/reset/${token}`);
    expect(message.html).toContain(`${BASE}/reset/${token}`);
    const [row] = getDb().select().from(passwordResets).all();
    expect(row.id).not.toBe(token);
    expect(row.id).toMatch(/^[0-9a-f]{64}$/);
    expect(resetTarget(token)?.email).toBe(EMAIL);
    expect(resetTarget("x")).toBeNull();
  });

  it("changes the password once, revokes sessions, all outstanding links and the old calendar credential", async () => {
    getDb().insert(sessions).values({ id: "session-1", userId, expiresAt: "2027-01-01T00:00:00.000Z" }).run();
    const mail = outbox();
    mail.request();
    mail.request();
    await mail.deliver();
    const [older, token] = mail.send.mock.calls.map(([message]) => tokenIn(String(message.text)));
    expect(resetPassword(token, "new-password-2")).toBe(true);
    const user = getDb().select().from(users).where(eq(users.id, userId)).get()!;
    expect(verifyPassword("new-password-2", user.passwordHash)).toBe(true);
    expect(verifyPassword("old-password-1", user.passwordHash)).toBe(false);
    expect(user.feedToken).not.toBe(feedToken);
    expect(getDb().select().from(users).where(eq(users.feedToken, feedToken)).get()).toBeUndefined();
    expect(getDb().select().from(sessions).where(eq(sessions.userId, userId)).all()).toEqual([]);
    expect(resetPassword(token, "another-password-3")).toBe(false);
    expect(resetTarget(older)).toBeNull();
    mail.request();
    mail.request();
    await mail.deliver();
    expect(mail.send).toHaveBeenCalledTimes(RESET_LIMIT);
  });

  it("refuses an expired link", async () => {
    const mail = outbox();
    mail.request();
    await mail.deliver();
    const token = tokenIn(String(mail.send.mock.calls[0][0].text));
    expect(resetTarget(token)).not.toBeNull();
    vi.setSystemTime(Date.now() + 61 * 60_000);
    expect(resetTarget(token)).toBeNull();
    expect(resetPassword(token, "late-password-4")).toBe(false);
  });

  it("hides SMTP failure and releases the unusable link", async () => {
    const mail = outbox();
    mail.send.mockRejectedValueOnce(new Error("SMTP down"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(mail.request()).toBe("sent");
    await mail.deliver();
    expect(log).toHaveBeenCalledOnce();
    expect(getDb().select().from(passwordResets).all()).toEqual([]);
  });

  it("requires a configured HTTP(S) URL outside development and never queues mail without it", () => {
    vi.stubEnv("NODE_ENV", "production");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const headers = new Headers({ host: "localhost:3100" });
    const mail = outbox();
    for (const value of ["", "invalid", "file:///tmp"]) {
      vi.stubEnv("APP_URL", value);
      expect(mail.request(EMAIL, resetBaseUrl(headers))).toBe("not-configured");
    }
    expect(mail.jobs).toHaveLength(0);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("APP_URL"));
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("APP_URL", "");
    expect(resetBaseUrl(headers)).toBe("http://localhost:3100");
  });

  it("reports unconfigured SMTP before scheduling a delivery", () => {
    vi.stubEnv("SMTP_HOST", "");
    const defer = vi.fn();
    expect(requestPasswordReset(EMAIL, BASE, "ro", defer)).toBe("not-configured");
    expect(defer).not.toHaveBeenCalled();
  });

  it("writes the message in English too and escapes the name", () => {
    const mail = resetEmail({ name: "<b>Eve</b> O'Neil" }, `${BASE}/reset/abc`, "en");
    expect(mail.subject).toBe("Reset your Poli password");
    expect(mail.text).toContain("Hi <b>Eve</b>,");
    expect(mail.html).toContain("Hi &lt;b&gt;Eve&lt;/b&gt;,");
  });
});
