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
    // Resend's own error text for this case talks about "verifying a
    // domain," which reads as if the domain itself isn't verified — but if
    // RESEND_FROM_EMAIL was never set, the real issue is that we're still
    // sending from Resend's shared onboarding@resend.dev test address,
    // which can only email the Resend account's own inbox no matter how
    // many domains are verified on the account. Make that distinction
    // explicit so a verified-domain screenshot doesn't lead down the wrong
    // path a second time.
    const hint = !process.env.RESEND_FROM_EMAIL
      ? " — no RESEND_FROM_EMAIL is set, so this is still sending from Resend's shared test address (onboarding@resend.dev), which can only reach your own Resend account email regardless of any domain you've verified. Set RESEND_FROM_EMAIL in Vercel to an address on your verified domain (e.g. quotes@yourdomain.com) and redeploy."
      : "";
    throw new Error(`Email failed to send: ${error.message || String(error)}${hint}`);
  }
  return data;
}
