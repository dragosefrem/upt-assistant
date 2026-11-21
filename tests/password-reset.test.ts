import { eq } from "drizzle-orm";
import nodemailer from "nodemailer";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db";
import { passwordResets, sessions, users } from "@/db/schema";
import { createUser, verifyPassword } from "@/lib/auth";
import { RESET_LIMIT, requestPasswordReset, resetEmail, resetPassword, resetTarget } from "@/lib/password-reset";

/** Captures messages instead of sending them. */
function outbox() {
  const transport = nodemailer.createTransport({ jsonTransport: true });
  const sent: Array<{ to: string; subject: string; text: string; html: string }> = [];
  const send = transport.sendMail.bind(transport);
  transport.sendMail = (async (message: Parameters<typeof send>[0]) => {
    const info = await send(message);
    const parsed = JSON.parse((info as unknown as { message: string }).message);
    sent.push({ to: parsed.to[0].address, subject: parsed.subject, text: parsed.text, html: parsed.html });
    return info;
  }) as typeof transport.sendMail;
  return { transport, sent };
}

const tokenIn = (text: string) => /\/reset\/([A-Za-z0-9_-]+)/.exec(text)![1];
const BASE = "https://orar.example.org";

describe("password reset", () => {
  let userId: string;

  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-23T08:00:00Z"));
    process.env.DATABASE_PATH = ":memory:";
    const user = createUser({ email: "Ana@Example.com", name: "Ana Popescu", password: "old-password-1", locale: "ro" });
    userId = user.id;
    getDb().insert(sessions).values({ id: "session-1", userId, expiresAt: "2027-01-01T00:00:00.000Z" }).run();
  });

  it("answers the same for an unknown address and sends nothing", async () => {
    const { transport, sent } = outbox();
    expect(await requestPasswordReset("nobody@example.com", BASE, "en", transport)).toBe("sent");
    expect(sent).toEqual([]);
    expect(getDb().select().from(passwordResets).all()).toEqual([]);
  });

  it("e-mails a one-time link in the account's language and stores only its hash", async () => {
    const { transport, sent } = outbox();
    expect(await requestPasswordReset("  ANA@example.com ", BASE, "en", transport)).toBe("sent");
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("ana@example.com");
    // The account chose Romanian, whatever language the request came in.
    expect(sent[0].subject).toBe("Resetează-ți parola UPT Orar");
    expect(sent[0].text).toContain("Salut, Ana,");
    const token = tokenIn(sent[0].text);
    expect(sent[0].text).toContain(`${BASE}/reset/${token}`);
    expect(sent[0].html).toContain(`${BASE}/reset/${token}`);
    const [row] = getDb().select().from(passwordResets).all();
    expect(row.id).not.toBe(token);
    expect(row.id).toMatch(/^[0-9a-f]{64}$/);
    expect(resetTarget(token)).toMatchObject({ email: "ana@example.com" });
    expect(resetTarget("not-a-real-token-0000000000")).toBeNull();
    expect(resetTarget("x")).toBeNull();
  });

  it("sets the new password once, signs the account out everywhere and spends every link", async () => {
    const { transport, sent } = outbox();
    await requestPasswordReset("ana@example.com", BASE, "ro", transport);
    const token = tokenIn(sent[0].text);
    const older = getDb().select().from(passwordResets).all();
    expect(older).toHaveLength(2);

    expect(resetPassword(token, "new-password-2")).toBe(true);
    const user = getDb().select().from(users).where(eq(users.id, userId)).get()!;
    expect(verifyPassword("new-password-2", user.passwordHash)).toBe(true);
    expect(verifyPassword("old-password-1", user.passwordHash)).toBe(false);
    expect(getDb().select().from(sessions).where(eq(sessions.userId, userId)).all()).toEqual([]);
    // The link cannot be used again, and the earlier unused link died with it.
    expect(resetPassword(token, "another-password-3")).toBe(false);
    expect(resetTarget(token)).toBeNull();
    expect(getDb().select().from(passwordResets).all().filter((r) => !r.usedAt)).toEqual([]);
  });

  it("stops after a few links in an hour, then allows more", async () => {
    const { transport, sent } = outbox();
    getDb().delete(passwordResets).run();
    for (let i = 0; i < RESET_LIMIT; i++) expect(await requestPasswordReset("ana@example.com", BASE, "ro", transport)).toBe("sent");
    expect(await requestPasswordReset("ana@example.com", BASE, "ro", transport)).toBe("too-many");
    expect(sent).toHaveLength(RESET_LIMIT);
    vi.setSystemTime(new Date("2026-11-23T09:01:00Z"));
    expect(await requestPasswordReset("ana@example.com", BASE, "ro", transport)).toBe("sent");
  });

  it("refuses an expired link", async () => {
    const { transport, sent } = outbox();
    getDb().delete(passwordResets).run();
    await requestPasswordReset("ana@example.com", BASE, "ro", transport);
    const token = tokenIn(sent[0].text);
    expect(resetTarget(token)).not.toBeNull();
    vi.setSystemTime(new Date(Date.now() + 61 * 60_000));
    expect(resetTarget(token)).toBeNull();
    expect(resetPassword(token, "late-password-4")).toBe(false);
  });

  it("keeps the request when the mail server fails, without leaving a usable link", async () => {
    getDb().delete(passwordResets).run();
    const broken = nodemailer.createTransport({ jsonTransport: true });
    broken.sendMail = (async () => {
      throw new Error("SMTP down");
    }) as typeof broken.sendMail;
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await requestPasswordReset("ana@example.com", BASE, "ro", broken)).toBe("failed");
    quiet.mockRestore();
    expect(getDb().select().from(passwordResets).all()).toEqual([]);
  });

  it("says so when no mail server is configured", async () => {
    const saved = { host: process.env.SMTP_HOST, user: process.env.SMTP_USER, pass: process.env.SMTP_PASS };
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    expect(await requestPasswordReset("ana@example.com", BASE, "ro")).toBe("not-configured");
    Object.assign(process.env, Object.fromEntries(Object.entries({ SMTP_HOST: saved.host, SMTP_USER: saved.user, SMTP_PASS: saved.pass }).filter(([, v]) => v)));
  });

  it("writes the message in English too and escapes the name", () => {
    const mail = resetEmail({ name: "<b>Eve</b> O'Neil" }, `${BASE}/reset/abc`, "en");
    expect(mail.subject).toBe("Reset your UPT Orar password");
    expect(mail.text).toContain("Hi <b>Eve</b>,");
    expect(mail.html).toContain("Hi &lt;b&gt;Eve&lt;/b&gt;,");
    expect(mail.html).not.toContain("<b>Eve</b>");
  });
});
