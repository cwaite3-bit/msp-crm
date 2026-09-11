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
import { headers } from "next/headers";

export type NewCustomerLead = {
  customerId: string;
  companyName: string;
  industry: string | null;
  website: string | null;
  employeeCount: number | null;
  phone: string | null;
  email: string | null;
  address: string;
  contactName: string;
  contactTitle: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  message: string | null;
};

// Absolute base URL for links inside notification/MSA emails. Prefers the
// explicit env var (set it in Vercel if you want a fixed value — e.g. a
// custom domain), but if it's unset this used to silently fall back to ""
// and produce a bare relative link like "/msa/<token>" with no domain at
// all — which looks fine in code but is a dead, blank-page link the moment
// it's clicked from an email client, since there's no page to resolve it
// against. Falling back to the actual Host header of the request that
// triggered the email (available here because every caller runs inside a
// Server Action/Route Handler request) means a working absolute link goes
// out even when NEXT_PUBLIC_APP_URL was never configured.
export async function appUrl(): Promise<string> {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL;
  try {
    const hdrs = await headers();
    const host = hdrs.get("host");
    if (host) {
      const proto = hdrs.get("x-forwarded-proto") || "https";
      return `${proto}://${host}`;
    }
  } catch {
    // headers() throws outside a request context (e.g. a one-off script run
    // via tsx, like db:seed) — fall through to an empty base rather than
    // crash a caller that doesn't actually need a link.
  }
  return "";
}

// Every value below comes from the public, unauthenticated customer intake
// form (see src/server/actions/public-intake.ts) — escape before
// interpolating into the notification email's HTML so a prospect can't
// inject markup/links into what lands in your inbox.
function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
  const url = `${await appUrl()}/q/${quote.publicToken}`;

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

// Fires when a prospect submits the public "new customer" intake form
// (/new-customer — see src/server/actions/public-intake.ts). Emails every
// ADMIN user (same "no separate who-gets-notified setting" reasoning as
// notifyQuoteCreator above — for a single-admin shop that's just the one
// login, and it scales cleanly if more admins get added later) with
// everything worth seeing at a glance, plus a link straight into the new
// customer record. NEVER throws: the customer's submission must still
// succeed even if their notification email fails to send, so failures are
// only logged, matching notifyQuoteCreator's best-effort pattern. Silently
// no-ops if RESEND_API_KEY isn't set.
export async function notifyNewCustomerLead(lead: NewCustomerLead) {
  if (!isEmailConfigured()) return;
  try {
    const admins = await db.select({ email: users.email }).from(users).where(eq(users.role, "ADMIN"));
    const recipients = [...new Set(admins.map((a) => a.email).filter(Boolean))];
    if (recipients.length === 0) return;

    const rows: [string, string | null][] = [
      ["Company", lead.companyName],
      ["Industry", lead.industry],
      ["Website", lead.website],
      ["Employees", lead.employeeCount ? String(lead.employeeCount) : null],
      ["Company phone", lead.phone],
      ["Company email", lead.email],
      ["Address", lead.address || null],
      ["Contact", lead.contactName],
      ["Contact title", lead.contactTitle],
      ["Contact email", lead.contactEmail],
      ["Contact phone", lead.contactPhone],
    ];
    const rowsHtml = rows
      .filter((r): r is [string, string] => Boolean(r[1]))
      .map(
        ([label, value]) =>
          `<tr><td style="padding:4px 16px 4px 0;color:#64748b;font-size:13px;white-space:nowrap;vertical-align:top;">${escapeHtml(label)}</td><td style="padding:4px 0;font-size:13px;font-weight:600;color:#0f172a;">${escapeHtml(value)}</td></tr>`
      )
      .join("");

    const html = `<p>A new customer record was just created from the website intake form:</p>
<table cellpadding="0" cellspacing="0">${rowsHtml}</table>
${lead.message ? `<p style="margin-top:14px;margin-bottom:2px;color:#64748b;font-size:13px;">What they're looking for:</p><p style="white-space:pre-wrap;">${escapeHtml(lead.message)}</p>` : ""}
<p style="margin-top:18px;"><a href="${await appUrl()}/customers/${lead.customerId}">Open this customer in the CRM</a></p>`;

    for (const to of recipients) {
      await sendEmail({ to, subject: `New customer lead — ${lead.companyName}`, html });
    }
  } catch (err) {
    console.error(`notifyNewCustomerLead failed for customer ${lead.customerId}:`, err);
  }
}
