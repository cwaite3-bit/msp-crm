// Shown on the client-facing quote page and the MSA (both the public
// signing page and the PDF) so the client sees a real person — whichever
// staff member generated the document (quotes.createdById) — rather than
// just a company name. Photo/title/phone are optional (Settings → Staff
// accounts) so this still renders sensibly for an account with only a name
// and email on file.
import Image from "next/image";
import { Mail, Phone } from "lucide-react";

export function AccountContactCard({
  name,
  title,
  email,
  phone,
  photoUrl,
}: {
  name: string;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  photoUrl?: string | null;
}) {
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="flex items-center gap-3 rounded-lg border border-[#bcdcf7] bg-[#eaf4fd] p-3">
      {photoUrl ? (
        <Image
          src={photoUrl}
          alt={name}
          width={48}
          height={48}
          className="h-12 w-12 shrink-0 rounded-full object-cover"
          unoptimized
        />
      ) : (
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#024996] text-sm font-semibold text-white">
          {initials || "?"}
        </div>
      )}
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-[#024996]">Your point of contact</p>
        <p className="truncate text-sm font-semibold text-slate-900">
          {name}
          {title ? <span className="font-normal text-slate-500"> — {title}</span> : null}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-600">
          {email && (
            <a href={`mailto:${email}`} className="flex items-center gap-1 hover:underline">
              <Mail className="h-3 w-3" /> {email}
            </a>
          )}
          {phone && (
            <a href={`tel:${phone}`} className="flex items-center gap-1 hover:underline">
              <Phone className="h-3 w-3" /> {phone}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
