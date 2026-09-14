import { auth } from "@/auth";
import { NextResponse } from "next/server";

export default auth(function proxy(req) {
  const { pathname } = req.nextUrl;

  const isPublic =
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/q/") || // shareable client-facing quote links
    pathname.startsWith("/msa/") || // public MSA review/e-signing page (unguessable token, no login)
    pathname.startsWith("/api/msa/token/") || // public "download this MSA as PDF" button on that page
    pathname.startsWith("/new-customer") || // public prospect intake form
    pathname.startsWith("/api/public") ||
    pathname.startsWith("/api/quickbooks/callback");

  if (isPublic) return NextResponse.next();

  if (!req.auth) {
    const loginUrl = new URL("/login", req.nextUrl.origin);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
});

export const config = {
  // Also exclude plain static files served from /public (logo, icons, etc.)
  // — without this, Next's image optimizer fetches them internally with no
  // session cookie attached, the proxy redirects that fetch to /login, and
  // the "image" it gets back is a login page, which fails to render.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|avif)$).*)"],
};
