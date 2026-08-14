import { db } from "@/server/db";
import { customers, contacts, notes, quotes, users } from "@/server/db/schema";
import { eq, desc } from "drizzle-orm";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/status-badge";
import { formatCurrency, formatDate } from "@/lib/utils";
import Link from "next/link";
import { NewQuoteButton } from "@/app/(app)/quotes/new-quote-button";
import { EditCustomerForm } from "./edit-customer-form";
import { ContactsPanel } from "./contacts-panel";
import { NotesPanel } from "./notes-panel";

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [customer] = await db.select().from(customers).where(eq(customers.id, id)).limit(1);
  if (!customer) notFound();

  const [customerContacts, customerNotesRaw, customerQuotes] = await Promise.all([
    db.select().from(contacts).where(eq(contacts.customerId, id)).orderBy(desc(contacts.isPrimary)),
    db
      .select({ note: notes, authorName: users.name })
      .from(notes)
      .leftJoin(users, eq(notes.authorId, users.id))
      .where(eq(notes.customerId, id))
      .orderBy(desc(notes.createdAt)),
    db.select().from(quotes).where(eq(quotes.customerId, id)).orderBy(desc(quotes.createdAt)),
  ]);

  const customerNotes = customerNotesRaw.map((r) => ({ ...r.note, authorName: r.authorName }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-slate-900">{customer.name}</h1>
            <Badge variant="secondary" className="capitalize">
              {customer.status.toLowerCase()}
            </Badge>
          </div>
          <p className="text-sm text-slate-500">
            {customer.industry || "No industry set"} {customer.website ? `· ${customer.website}` : ""}
          </p>
        </div>
        <NewQuoteButton customerId={customer.id} contacts={customerContacts} />
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="contacts">Contacts ({customerContacts.length})</TabsTrigger>
          <TabsTrigger value="activity">Activity ({customerNotes.length})</TabsTrigger>
          <TabsTrigger value="quotes">Quotes ({customerQuotes.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <Card>
            <CardHeader>
              <CardTitle>Company details</CardTitle>
            </CardHeader>
            <CardContent>
              <EditCustomerForm customer={customer} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="contacts">
          <Card>
            <CardHeader>
              <CardTitle>Contacts</CardTitle>
            </CardHeader>
            <CardContent>
              <ContactsPanel customerId={customer.id} contacts={customerContacts} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activity">
          <Card>
            <CardHeader>
              <CardTitle>Notes &amp; activity</CardTitle>
            </CardHeader>
            <CardContent>
              <NotesPanel customerId={customer.id} notes={customerNotes} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="quotes">
          <Card>
            <CardHeader>
              <CardTitle>Quotes</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col divide-y divide-slate-100">
              {customerQuotes.length === 0 && <p className="py-4 text-sm text-slate-500">No quotes yet.</p>}
              {customerQuotes.map((q) => (
                <Link
                  key={q.id}
                  href={`/quotes/${q.id}`}
                  className="flex items-center justify-between py-3 text-sm hover:bg-slate-50"
                >
                  <div>
                    <div className="font-medium text-slate-900">
                      #{q.quoteNumber} · {q.title}
                    </div>
                    <div className="text-slate-500">Created {formatDate(q.createdAt)}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-medium">{formatCurrency(q.totalMonthly)}/mo</span>
                    <StatusBadge status={q.status} />
                  </div>
                </Link>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
