import { eq } from "drizzle-orm";
import nodemailer from "nodemailer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db";
import { registrationLinks, sessions, users } from "@/db/schema";
import { completeRegistration, registrationTarget, requestRegistrationLink } from "@/lib/account-verification";
import { authenticate, createUser } from "@/lib/auth";
import { accountEmailBaseUrl } from "@/lib/mail";

const address = "ana+poli@example.org";
const input = { email: address, locale: "ro", invite: "a".repeat(32), baseUrl: "https://poli.example.org", client: "test-client" } as const;
const details = { name: "Ana Popescu", password: "a-test-password", locale: "ro" } as const;
const fetchMail = vi.fn<typeof fetch>();
function delivered(index = 0) {
  const [endpoint, options] = fetchMail.mock.calls[index];
  const message = JSON.parse(String(options?.body)) as { from: string; to: string; text: string; subject: string };
  const token = /\/verify\/([\w-]{43})/.exec(message.text)![1];
  return { endpoint, options, message, token };
}

describe("account verification", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.stubEnv("DATABASE_PATH", ":memory:");
    vi.stubEnv("RESEND_API_KEY", "test-sending-key");
    vi.stubEnv("VERIFICATION_EMAIL_FROM", "Poli <signup@mail.example.org>");
    getDb().delete(registrationLinks).run();
    getDb().delete(users).run();
    vi.stubGlobal("fetch", fetchMail.mockReset().mockResolvedValue(new Response(null, { status: 200 })));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("sends the Romanian link over HTTPS and creates the account only on confirmation", async () => {
    expect(await requestRegistrationLink({ ...input, email: "  " + address.toUpperCase() + "  " })).toBe("sent");
    const { endpoint, message, options, token } = delivered();
    expect(endpoint).toBe("https://api.resend.com/emails");
    const storedId = getDb().select().from(registrationLinks).get()!.id;
    expect(options?.headers).toMatchObject({ Authorization: "Bearer test-sending-key", "Idempotency-Key": `registration/${storedId}` });
    expect(message).toMatchObject({ to: address, subject: "Confirmă adresa de e-mail pentru Poli", from: "Poli <signup@mail.example.org>" });
    expect(message.text).toContain(input.baseUrl + "/verify/" + token);
    expect(storedId).not.toBe(token);
    expect(registrationTarget(token)).toEqual({ email: address, invite: input.invite });
    expect(getDb().select().from(users).all()).toHaveLength(0);
    expect(getDb().select().from(sessions).all()).toHaveLength(0);
    expect(authenticate(address, details.password, "test").status).toBe("invalid");
    const result = completeRegistration(token, details);
    expect(result?.user).toMatchObject({ email: address, emailVerifiedAt: new Date().toISOString(), role: "admin" });
    expect(result?.invite).toBe(input.invite);
    expect(authenticate(address, details.password, "test").status).toBe("signed-in");
    expect(completeRegistration(token, details)).toBeNull();
  });

  it("throttles concurrent sends and resends, and invalidates every sibling link at completion", async () => {
    expect(await Promise.all([requestRegistrationLink(input), requestRegistrationLink(input)])).toEqual(["sent", "verificationLimited"]);
    for (let i = 0; i < 2; i++) {
      vi.setSystemTime(Date.now() + 60_000);
      expect(await requestRegistrationLink(input)).toBe("sent");
    }
    vi.setSystemTime(Date.now() + 60_000);
    expect(await requestRegistrationLink(input)).toBe("verificationLimited");
    expect(completeRegistration(delivered(1).token, details)).not.toBeNull();
    for (const i of [0, 1, 2]) expect(registrationTarget(delivered(i).token)).toBeNull();
    expect(await requestRegistrationLink(input)).toBe("exists");
    expect(fetchMail).toHaveBeenCalledTimes(3);
  });

  it("rejects expired or unknown links and allows a fresh request after expiry", async () => {
    await requestRegistrationLink(input);
    vi.setSystemTime(Date.now() + 60 * 60_000);
    for (const token of ["bad token", "b".repeat(43), delivered().token]) {
      expect(registrationTarget(token)).toBeNull();
      expect(completeRegistration(token, details)).toBeNull();
    }
    expect(await requestRegistrationLink({ ...input, locale: "en" })).toBe("sent");
    expect(delivered(1).message.subject).toBe("Verify your e-mail for Poli");
    expect(getDb().select().from(registrationLinks).all()).toHaveLength(1);
  });

  it("keeps an earlier link usable after delivery failure and allows retry", async () => {
    await requestRegistrationLink(input);
    vi.setSystemTime(Date.now() + 60_000);
    fetchMail.mockResolvedValueOnce(new Response(null, { status: 503 }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await requestRegistrationLink(input)).toBe("verificationSendFailed");
    expect(registrationTarget(delivered(1).token)).toBeNull();
    expect(registrationTarget(delivered().token)).not.toBeNull();
    expect(await requestRegistrationLink(input)).toBe("sent");
  });

  it("keeps existing accounts usable and reserves no account for invalid or undeliverable requests", async () => {
    const legacy = createUser({ ...details, email: address });
    expect(legacy.emailVerifiedAt).toBeNull();
    expect(await requestRegistrationLink(input)).toBe("exists");
    expect(authenticate(address, details.password, "test").status).toBe("signed-in");
    expect(await requestRegistrationLink({ ...input, email: "not a mailbox" })).toBe("badEmail");
    vi.stubEnv("VERIFICATION_EMAIL_FROM", "");
    expect(await requestRegistrationLink({ ...input, email: "new@example.org" })).toBe("verificationUnavailable");
    expect(getDb().select().from(users).where(eq(users.email, address)).get()).toEqual(legacy);
    expect(getDb().select().from(registrationLinks).all()).toHaveLength(0);
    expect(fetchMail).not.toHaveBeenCalled();
  });

  it("uses the configured SMTP mailbox when Resend is unset", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("SMTP_HOST", "mail.example.org");
    vi.stubEnv("SMTP_USER", "sender@example.org");
    vi.stubEnv("SMTP_PASS", "test");
    const transport = nodemailer.createTransport({ jsonTransport: true });
    const send = vi.spyOn(transport, "sendMail");
    vi.spyOn(nodemailer, "createTransport").mockReturnValue(transport);
    expect(await requestRegistrationLink(input)).toBe("sent");
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: address, text: expect.stringContaining("/verify/") }));
    expect(fetchMail).not.toHaveBeenCalled();
  });

  it("uses Railway’s HTTPS domain or the configured custom domain for production mail", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RAILWAY_ENVIRONMENT_ID", "test");
    vi.stubEnv("RAILWAY_PUBLIC_DOMAIN", "poli.up.railway.app");
    vi.stubEnv("APP_URL", "");
    const headers = new Headers({ host: "internal.railway", "x-forwarded-host": "alternative.example" });
    expect(accountEmailBaseUrl(headers)).toBe("https://poli.up.railway.app");
    vi.stubEnv("APP_URL", "https://poli.example.org/");
    expect(accountEmailBaseUrl(headers)).toBe(input.baseUrl);
    vi.stubEnv("APP_URL", "http://poli.example.org");
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(accountEmailBaseUrl(headers)).toBeNull();
  });
});
