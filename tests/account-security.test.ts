import { scryptSync } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { authenticate, createUser, loginClientAddress, registrationName } from "@/lib/auth";

vi.mock("node:crypto", { spy: true });
process.env.DATABASE_PATH = ":memory:";

describe("sign in", () => {
  const email = "student@example.com";
  beforeAll(() => createUser({ email, name: "Test Student", password: "correct-password" }));
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  it("runs one full password verification for both kinds of rejected credentials", () => {
    const scrypt = vi.mocked(scryptSync);
    for (const address of [email, "unregistered@example.com"]) {
      scrypt.mockClear();
      expect(authenticate(address, "incorrect", "client-a")).toEqual({ status: "invalid" });
      expect(scrypt).toHaveBeenCalledExactlyOnceWith("incorrect", expect.any(Buffer), 64);
    }
    expect(authenticate(email, "correct-password", "client-a").status).toBe("signed-in");
  });

  it("limits the normalized address across clients until the window expires", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    for (let i = 0; i < 5; i++) expect(authenticate(email, "incorrect", String(i)).status).toBe("invalid");
    expect(authenticate(email.toUpperCase(), "correct-password", "another")).toEqual({ status: "limited", minutes: 15 });
    vi.setSystemTime(Date.now() + 14 * 60_000);
    expect(authenticate(email, "correct-password", "another")).toEqual({ status: "limited", minutes: 1 });
    vi.setSystemTime(Date.now() + 60_000);
    expect(authenticate(email, "correct-password", "another").status).toBe("signed-in");
  });

  it("limits cumulative failures from one client and leaves a different client available", () => {
    for (let i = 0; i < 30; i++) {
      expect(authenticate(`student-${i}@example.com`, "incorrect", "client-b").status).toBe("invalid");
    }
    expect(authenticate(email, "correct-password", "client-b").status).toBe("limited");
    expect(authenticate(email, "correct-password", "client-c").status).toBe("signed-in");
  });

  it("uses the edge's client IP and groups unidentified clients together", () => {
    vi.stubEnv("RAILWAY_ENVIRONMENT_ID", "test");
    vi.stubEnv("TRUSTED_CLIENT_IP_HEADER", "");
    expect(loginClientAddress(new Headers({ "x-real-ip": "192.0.2.5" }))).toBe("192.0.2.5");
    expect(loginClientAddress(new Headers())).toBe("unidentified");
    expect(loginClientAddress(new Headers({ "x-real-ip": "unknown" }))).toBe("unidentified");
  });
});

describe("registration names", () => {
  it("stores a single trimmed line and removes invisible formatting controls", () => {
    const user = createUser({ name: " \u202eAna\u0000\n  Maria\u2009Șerban\u200b ", email: "ana@example.com", password: "test-password" });
    expect(user.name).toBe("Ana Maria Șerban");
    expect(registrationName("\u0000\n\u200b").error).toBe("needName");
  });
  it("accepts 80 Unicode characters and rejects a longer registration", () => {
    expect(registrationName("𐐀".repeat(80)).error).toBeNull();
    expect(registrationName("a".repeat(81)).error).toBe("longName");
    expect(() => createUser({ email: "long@example.com", name: "a".repeat(81), password: "test-password" })).toThrow(RangeError);
  });
});
