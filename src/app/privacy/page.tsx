import Image from "next/image";

// Public, unauthenticated page (see src/proxy.ts) — exists mainly to satisfy
// Intuit's requirement for a public privacy policy URL before issuing
// QuickBooks Online Production API keys. Describes, at a plain-language
// level, the actual data this app collects and why — customer/contact
// details, quote and MSA content, e-signatures and the signer's IP address
// captured at signing time (see src/server/actions/msa.ts), and the public
// intake form's submissions (see src/server/actions/public-intake.ts) —
// since those are all real data flows in this app, not boilerplate.
export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-slate-100 py-10 print:bg-white print:py-0">
      <div className="mx-auto max-w-3xl rounded-xl bg-white shadow-lg print:shadow-none">
        <div className="flex items-center justify-center rounded-t-xl border-b border-slate-100 bg-white px-8 py-5">
          <Image src="/lockdown-logo.png" alt="Lockdown IT" width={5052} height={1264} className="h-10 w-auto" priority />
        </div>

        <div className="px-8 py-8">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#1d98eb]">Lockdown IT</p>
          <h1 className="mt-1 text-2xl font-semibold text-[#024996]">Privacy Policy</h1>
          <p className="mt-1 text-sm text-slate-500">Last updated {new Date().toLocaleDateString()}</p>

          <div className="mt-6 flex flex-col gap-5 text-sm leading-relaxed text-slate-700">
            <p>
              This privacy policy covers Lockdown IT&rsquo;s internal quoting, customer-relationship, and billing
              application (the &ldquo;Software&rdquo;), including the pages it generates for customers to review
              quotes, review and sign Master Service Agreements, and submit their information through our
              new-customer intake form.
            </p>

            <div>
              <h2 className="mb-1.5 text-sm font-semibold text-[#024996]">Information we collect</h2>
              <p>Depending on how you interact with us, we may collect:</p>
              <ul className="mt-2 list-disc pl-5">
                <li>Company and contact information you or Lockdown IT staff enter — name, company, address, phone number, and email address.</li>
                <li>The contents of quotes and Master Service Agreements prepared for you, including services, pricing, and billing preferences.</li>
                <li>
                  If you sign a Master Service Agreement online: your typed name and title, a drawn signature image,
                  the date and time of signing, and the IP address the signature was submitted from — captured as
                  part of maintaining a durable signing record.
                </li>
                <li>Basic technical information (such as IP address) associated with requests to our public pages.</li>
              </ul>
            </div>

            <div>
              <h2 className="mb-1.5 text-sm font-semibold text-[#024996]">How we use this information</h2>
              <p>
                We use this information to prepare and deliver quotes and agreements, invoice for services through
                QuickBooks Online, communicate with you about your account, and maintain accurate business records.
                We do not sell your information to third parties.
              </p>
            </div>

            <div>
              <h2 className="mb-1.5 text-sm font-semibold text-[#024996]">Third-party services</h2>
              <p>
                We use QuickBooks Online (Intuit) to manage invoicing and a transactional email provider to send
                quote, agreement, and account notifications. These providers process data on our behalf and are
                subject to their own privacy and security practices.
              </p>
            </div>

            <div>
              <h2 className="mb-1.5 text-sm font-semibold text-[#024996]">Data retention</h2>
              <p>
                We retain quote, agreement, and signature records for as long as reasonably necessary for our
                business, tax, and legal record-keeping purposes.
              </p>
            </div>

            <div>
              <h2 className="mb-1.5 text-sm font-semibold text-[#024996]">Your choices</h2>
              <p>
                If you&rsquo;d like to review, correct, or request deletion of information we hold about you, contact
                us using the information on your quote, agreement, or invoice.
              </p>
            </div>

            <div>
              <h2 className="mb-1.5 text-sm font-semibold text-[#024996]">Changes to this policy</h2>
              <p>We may update this policy from time to time by posting a revised version at this URL.</p>
            </div>

            <div>
              <h2 className="mb-1.5 text-sm font-semibold text-[#024996]">Contact</h2>
              <p>Questions about this policy can be directed to Lockdown IT through the contact information provided on your quote, agreement, or invoice.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
