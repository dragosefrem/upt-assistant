import "server-only";

export const GUEST_COOKIE = "upt_guest";

export function guestCookie(token: string, key: string) {
  return {
    name: GUEST_COOKIE, value: key, path: `/join/${token}`, httpOnly: true,
    sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", maxAge: 365 * 86400,
  };
}
