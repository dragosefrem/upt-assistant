import "server-only";
import nodemailer, { type Transporter } from "nodemailer";

type MailPurpose = "account" | "calendar";

interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: { filename: string; content: string; contentType: string }[];
}

function mailProvider(purpose: MailPurpose) {
  const smtpReady = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
  // Installations with a dedicated SMTP calendar sender keep using it.
  if (purpose === "calendar" && smtpReady) return "smtp";
  if (process.env.RESEND_API_KEY) return process.env.VERIFICATION_EMAIL_FROM?.trim() ? "resend" : null;
  return smtpReady ? "smtp" : null;
}

export function mailConfigured(purpose: MailPurpose): boolean {
  return mailProvider(purpose) !== null;
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

export async function sendMail(
  purpose: MailPurpose,
  message: MailMessage,
  idempotencyKey: string,
  transport?: Transporter,
) {
  const provider = mailProvider(purpose);
  if (transport || provider === "smtp") {
    await (transport ?? smtpTransport()).sendMail({ from: mailFrom(), ...message });
    return;
  }
  if (provider !== "resend") throw new Error("E-mail delivery is not configured");
  const { attachments, ...body } = message;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({
      from: process.env.VERIFICATION_EMAIL_FROM?.trim(),
      ...body,
      attachments: attachments?.map(({ filename, content, contentType }) => ({
        filename,
        content: Buffer.from(content, "utf8").toString("base64"),
        content_type: contentType.split(";", 1)[0],
      })),
    }),
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

function mailFrom(): string {
  if (process.env.MAIL_FROM) return process.env.MAIL_FROM;
  return process.env.SMTP_USER ? `Poli <${process.env.SMTP_USER}>` : "Poli <no-reply@localhost>";
}
