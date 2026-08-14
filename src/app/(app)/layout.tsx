import { auth } from "@/auth";
import { NavShell } from "@/components/nav-shell";
import { redirect } from "next/navigation";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <NavShell userName={session.user.name ?? session.user.email ?? "User"} userRole={session.user.role}>
      {children}
    </NavShell>
  );
}
