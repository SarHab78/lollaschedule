import nodemailer from "nodemailer";

// Transport-agnostic email sender. Today it goes through Gmail SMTP (free, no
// domain). To scale past Gmail's ~500/day cap, add a branch here (Resend/SES)
// keyed on its own env var — nothing else in the app changes.
//   Gmail:  GMAIL_USER + GMAIL_APP_PASSWORD   (a Google *app password*, not your
//           login password; requires 2-Step Verification on the account)
//   From:   MAIL_FROM (optional display) else GMAIL_USER

type Mail = { to: string; subject: string; text: string; html: string };

let cachedTransport: nodemailer.Transporter | null = null;

function gmailTransport(): nodemailer.Transporter | null {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) return null;
  if (!cachedTransport) {
    cachedTransport = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
    });
  }
  return cachedTransport;
}

// True when an email transport is configured. Lets callers degrade gracefully
// (e.g. hide the sign-in UI) instead of throwing when email isn't set up yet.
export function mailerEnabled(): boolean {
  return !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}

export async function sendEmail({ to, subject, text, html }: Mail): Promise<void> {
  const transport = gmailTransport();
  if (!transport) throw new Error("no_email_transport");
  const from = `LollaSchedule <${process.env.MAIL_FROM || process.env.GMAIL_USER}>`;
  await transport.sendMail({ from, to, subject, text, html });
}
