import { qboFetch, qboQuery } from "./client";

function qboEscape(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

type QboCustomer = { Id: string; DisplayName: string };
type QboItem = { Id: string; Name: string };
type QboAccount = { Id: string; Name: string };

export async function findOrCreateQboCustomer(input: {
  displayName: string;
  email?: string | null;
  phone?: string | null;
  billAddr?: { Line1?: string; City?: string; CountrySubDivisionCode?: string; PostalCode?: string };
}) {
  const existing = await qboQuery<QboCustomer>(
    `select Id, DisplayName from Customer where DisplayName = '${qboEscape(input.displayName)}'`
  );
  if (existing[0]) return existing[0].Id;

  const payload: Record<string, unknown> = { DisplayName: input.displayName };
  if (input.email) payload.PrimaryEmailAddr = { Address: input.email };
  if (input.phone) payload.PrimaryPhone = { FreeFormNumber: input.phone };
  if (input.billAddr && Object.values(input.billAddr).some(Boolean)) payload.BillAddr = input.billAddr;

  const created = (await qboFetch("/customer", {
    method: "POST",
    body: JSON.stringify(payload),
  })) as { Customer: QboCustomer };
  return created.Customer.Id;
}

let cachedIncomeAccountId: string | null = null;

async function getDefaultIncomeAccountId() {
  if (process.env.QBO_INCOME_ACCOUNT_ID) return process.env.QBO_INCOME_ACCOUNT_ID;
  if (cachedIncomeAccountId) return cachedIncomeAccountId;

  const accounts = await qboQuery<QboAccount>(
    `select Id, Name from Account where AccountType = 'Income' maxresults 1`
  );
  if (!accounts[0]) {
    throw new Error(
      "No Income account found in QuickBooks to attach new service items to. Create one in QuickBooks, or set QBO_INCOME_ACCOUNT_ID."
    );
  }
  cachedIncomeAccountId = accounts[0].Id;
  return cachedIncomeAccountId;
}

export async function findOrCreateQboItem(name: string) {
  const existing = await qboQuery<QboItem>(`select Id, Name from Item where Name = '${qboEscape(name)}'`);
  if (existing[0]) return existing[0].Id;

  const incomeAccountId = await getDefaultIncomeAccountId();
  const created = (await qboFetch("/item", {
    method: "POST",
    body: JSON.stringify({
      Name: name,
      Type: "Service",
      IncomeAccountRef: { value: incomeAccountId },
    }),
  })) as { Item: QboItem };
  return created.Item.Id;
}

export async function createQboInvoice(input: {
  customerId: string;
  lines: { itemId: string; description: string; quantity: number; unitPrice: number }[];
}) {
  const created = (await qboFetch("/invoice", {
    method: "POST",
    body: JSON.stringify({
      CustomerRef: { value: input.customerId },
      Line: input.lines.map((line) => ({
        Amount: Number((line.quantity * line.unitPrice).toFixed(2)),
        DetailType: "SalesItemLineDetail",
        Description: line.description,
        SalesItemLineDetail: {
          ItemRef: { value: line.itemId },
          Qty: line.quantity,
          UnitPrice: line.unitPrice,
        },
      })),
    }),
  })) as { Invoice: { Id: string; DocNumber?: string } };
  return created.Invoice;
}
