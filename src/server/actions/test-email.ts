"use server";

// Lets any logged-in staff user send themselves a one-off test email from
// Settings, to verify RESEND_API_KEY is actually working (and that their
// own account email is a real inbox) without having to walk a whole quote
// through Sent -> Accepted -> MSA signed just to trigger a notification.
import { auth } from "@/auth";
import { sendEmail, isEmailConfigured } from "@/server/email";

export async function sendTestEmail(): Promise<{ sent: boolean; error?: string; to?: string }> {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");

  if (!session.user.email) {
    return {
      sent: false,
      error: "Your account has no email address on file — check Staff accounts above.",
    };
  }
  if (!isEmailConfigured()) {
    return {
      sent: false,
      error: "RESEND_API_KEY isn't set in this environment's environment variables yet.",
    };
  }

  try {
    await sendEmail({
      to: session.user.email,
      subject: "MSP CRM — test email",
      html: `<p>This is a test email from the MSP CRM &amp; Quoting tool's Settings page.</p>
<p>If you're reading this, outbound email (Resend) is configured correctly — the quote-sent,
quote-accepted/declined, MSA-signed, and QuickBooks-invoice notifications will reach real inboxes too.</p>
<p style="color:#64748b;font-size:12px;">Sent ${new Date().toLocaleString()} to ${session.user.email}.</p>`,
    });
    return { sent: true, to: session.user.email };
  } catch (err) {
    return { sent: false, error: err instanceof Error ? err.message : "Failed to send the test email" };
  }
}
