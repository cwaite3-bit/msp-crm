// Public, unauthenticated intake page (no login) — send this link
// (/new-customer) to a prospect so they can fill out their own company and
// contact info. Submitting creates a LEAD in the CRM (see
// src/server/actions/public-intake.ts) and emails an admin notification, so
// a quote can be started for them without any manual data entry. Same
// no-auth, unguessable-URL-free pattern as the other public pages, except
// this one is a fixed/evergreen link rather than a per-record token, since
// its whole purpose is to CREATE a record rather than reference one.
import Image from "next/image";
import { IntakeForm } from "./intake-form";

export const metadata = {
  title: "New Customer — Lockdown IT",
};

export default function NewCustomerIntakePage() {
  return (
    <div className="min-h-screen bg-slate-100 py-10">
      <div className="mx-auto max-w-2xl rounded-xl bg-white shadow-lg">
        <div className="flex items-center justify-center rounded-t-xl border-b border-slate-100 bg-white px-8 py-5">
          <Image src="/lockdown-logo.png" alt="Lockdown IT" width={5052} height={1264} className="h-10 w-auto" priority />
        </div>

        <div className="bg-[#024996] px-8 py-8 text-white">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#7cc4f2]">New Customer</p>
          <h1 className="mt-1 text-2xl font-semibold">Tell us about your business</h1>
          <p className="mt-1 text-sm text-[#bcdcf7]">
            Fill this out and we&rsquo;ll follow up to put together a quote tailored to your environment.
          </p>
        </div>

        <div className="px-8 py-8">
          <IntakeForm />
        </div>
      </div>
    </div>
  );
}
