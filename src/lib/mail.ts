import "server-only";
import nodemailer, { type SendMailOptions, type Transporter } from "nodemailer";

/**
 * Outgoing e-mail over SMTP. Any mailbox that allows SMTP works: a Gmail or Outlook
 * account with an app password, or a sending service. Configured with SMTP_HOST,
 * SMTP_PORT, SMTP_USER, SMTP_PASS and optionally MAIL_FROM.
 */

export function mailConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

/** In production, links only use the operator's URL or Railway's assigned public domain. */
export function accountEmailBaseUrl(headers: Pick<Headers, "get">): string | null {
  const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();
  const configured = process.env.APP_URL?.trim() || (railwayDomain && `https://${railwayDomain}`);
  if (!configured && process.env.NODE_ENV === "development") return `http://${headers.get("host") ?? "localhost:3000"}`;
  if (configured) {
    try {
      const url = new URL(configured);
      const allowed = url.protocol === "https:" || (url.protocol === "http:" && !process.env.RAILWAY_ENVIRONMENT_ID);
      if (allowed && !url.username && !url.password && !url.search && !url.hash) {
        return url.origin + url.pathname.replace(/\/+$/, "");
      }
    } catch {
      // Never log the supplied value or a URL containing a verification token.
    }
  }
  console.error("Set APP_URL to the public address of this installation to send account links.");
  return null;
}

/** Registration and password resets share one sender. */
export function accountMailConfigured(): boolean {
  return process.env.RESEND_API_KEY ? Boolean(process.env.VERIFICATION_EMAIL_FROM?.trim()) : mailConfigured();
}

export async function sendAccountMail(
  message: { to: string; subject: string; text: string; html?: string },
  idempotencyKey: string,
  transport?: Transporter,
) {
  const key = process.env.RESEND_API_KEY;
  if (transport || !key) {
    await sendMail(message, transport);
    return;
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({ from: process.env.VERIFICATION_EMAIL_FROM, ...message }),
    redirect: "error",
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`Resend returned HTTP ${response.status}`);
}

let smtp: Transporter | null = null;

function smtpTransport(): Transporter {
  if (!smtp) {
    const port = Number(process.env.SMTP_PORT) || 587;
    smtp = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      // Port 465 speaks TLS from the first byte; 587 and 25 upgrade with STARTTLS.
      secure: port === 465,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return smtp;
}

export function mailFrom(): string {
  if (process.env.MAIL_FROM) return process.env.MAIL_FROM;
  return process.env.SMTP_USER ? `Poli <${process.env.SMTP_USER}>` : "Poli <no-reply@localhost>";
}

/** Sends one message; `transport` replaces SMTP in tests. */
export async function sendMail(message: SendMailOptions, transport: Transporter = smtpTransport()) {
  return transport.sendMail({ from: mailFrom(), ...message });
}
