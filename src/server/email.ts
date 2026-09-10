// Thin wrapper around Resend (already an installed dependency, previously
// unwired — see architecture doc) for sending the generated MSA PDF to a
// customer contact. Kept as its own tiny module so any future outbound
// email (e.g. quote-sent notifications) can reuse it without duplicating
// the "is it configured" check.
import { Resend } from "resend";

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  attachments?: { filename: string; content: Buffer }[];
};

export function isEmailConfigured() {
  return Boolean(process.env.RESEND_API_KEY);
}

export async function sendEmail(input: SendEmailInput) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Email is not configured yet — set RESEND_API_KEY (and optionally RESEND_FROM_EMAIL) in your environment variables to enable sending from the app."
    );
  }
  const resend = new Resend(apiKey);
  const from = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";

  const { data, error } = await resend.emails.send({
    from,
    to: input.to,
    subject: input.subject,
    html: input.html,
    attachments: input.attachments?.map((a) => ({
      filename: a.filename,
      content: a.content.toString("base64"),
    })),
  });

  if (error) {
    throw new Error(`Email failed to send: ${error.message || String(error)}`);
  }
  return data;
}
