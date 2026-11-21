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

let smtp: Transporter | null = null;

function smtpTransport(): Transporter {
  if (!smtp) {
    const port = Number(process.env.SMTP_PORT) || 587;
    smtp = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      // Port 465 speaks TLS from the first byte; 587 and 25 upgrade with STARTTLS.
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return smtp;
}

export function mailFrom(): string {
  if (process.env.MAIL_FROM) return process.env.MAIL_FROM;
  return process.env.SMTP_USER ? `UPT Orar <${process.env.SMTP_USER}>` : "UPT Orar <no-reply@localhost>";
}

/** Sends one message; `transport` replaces SMTP in tests. */
export async function sendMail(message: SendMailOptions, transport: Transporter = smtpTransport()) {
  return transport.sendMail({ from: mailFrom(), ...message });
}
