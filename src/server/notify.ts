// Notification emails for the quote/MSA lifecycle (see "Notifications" in
// the architecture doc). Two shapes, both riding on the existing
// src/server/email.ts Resend wrapper:
//
//  - notifyQuoteCreator: emails whichever staff member created the quote
//    (quotes.createdById), for events they'd want to know about — customer
//    accepted/declined, MSA signed, first invoice created in QuickBooks.
//    For a one-person shop that's just the one login; it scales cleanly if
//    more staff get added later, without needing a separate "who gets
//    notified" setting. NEVER throws - every call site is either a public
//    unauthenticated action (customer accept/reject/sign) or a background
//    step of a staff action that already succeeded, so a notification
//    hiccup should never roll back or surface as an error there. Silently
//    no-ops if RESEND_API_KEY isn't set, same as every other email feature
//    in this app.
//
//  - notifyCustomerQuoteSent: emails the quote's contact when staff clicks
//    "Mark as sent". Returns a result instead of throwing so the button
//    can tell staff whether the email actually went out (e.g. no contact
//    email on file) and fall back to "copy the client link" for that one
//    quote without blocking the status change itself.
import { db } from "@/server/db";
import { quotes, users, contacts, customers } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { sendEmail, isEmailConfigured } from "@/server/email";

export function appUrl() {
  return process.env.NEXT_PUBLIC_APP_URL || process.env.APP_BASE_URL || "";
}

export async function notifyQuoteCreator(quoteId: string, subject: string, html: string) {
  if (!isEmailConfigured()) return;
  try {
    const [quote] = await db.select().from(quotes).where(eq(quotes.id, quoteId)).limit(1);
    if (!quote) return;
    const [creator] = await db.select().from(users).where(eq(users.id, quote.createdById)).limit(1);
    if (!creator?.email) return;
    await sendEmail({ to: creator.email, subject, html });
  } catch (err) {
    // Best-effort - log for visibility in Vercel's function logs, but never
    // let a notification failure affect the caller.
    console.error(`notifyQuoteCreator failed for quote ${quoteId}:`, err);
  }
}

export async function notifyCustomerQuoteSent(quoteId: string): Promise<{ sent: boolean; error?: string }> {
  const [quote] = await db.select().from(quotes).where(eq(quotes.id, quoteId)).limit(1);
  if (!quote) return { sent: false, error: "Quote not found" };

  if (!quote.contactId) {
    return {
      sent: false,
      error: "No contact selected on this quote — pick one under Quote settings, or share the client link manually.",
    };
  }
  const [contact] = await db.select().from(contacts).where(eq(contacts.id, quote.contactId)).limit(1);
  if (!contact?.email) {
    return {
      sent: false,
      error: "The selected contact has no email on file — add one, or share the client link manually.",
    };
  }
  if (!isEmailConfigured()) {
    return { sent: false, error: "Email isn't configured yet (RESEND_API_KEY) — share the client link manually for now." };
  }

  const [customer] = await db.select().from(customers).where(eq(customers.id, quote.customerId)).limit(1);
  const url = `${appUrl()}/q/${quote.publicToken}`;

  try {
    await sendEmail({
      to: contact.email,
      subject: `Your quote from Lockdown IT — #${quote.quoteNumber}${quote.title ? `: ${quote.title}` : ""}`,
      html: `<p>Hi${contact.firstName ? ` ${contact.firstName}` : ""},</p>
<p>Your IT services quote${quote.title ? ` — "${quote.title}"` : ""} is ready to review${customer ? ` for ${customer.name}` : ""}.</p>
<p><a href="${url}">View and respond to your quote</a></p>
<p>Reply to this email if you have any questions.</p>`,
    });
    return { sent: true };
  } catch (err) {
    return { sent: false, error: err instanceof Error ? err.message : "Failed to send the email" };
  }
}
