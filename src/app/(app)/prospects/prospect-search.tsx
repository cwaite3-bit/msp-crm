"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Search, Loader2 } from "lucide-react";

// Same debounced query-param search pattern as CustomerSearch — kept as its
// own component (rather than sharing one) since the two lists live on
// different routes and this one's copy is prospect-specific.
export function ProspectSearch({ initialQuery }: { initialQuery: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [value, setValue] = useState(initialQuery);
  const [pending, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [prevInitialQuery, setPrevInitialQuery] = useState(initialQuery);
  if (initialQuery !== prevInitialQuery) {
    setPrevInitialQuery(initialQuery);
    setValue(initialQuery);
  }

  function handleChange(next: string) {
    setValue(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const params = new URLSearchParams();
      if (next.trim()) params.set("q", next.trim());
      startTransition(() => {
        router.replace(params.toString() ? `${pathname}?${params}` : pathname);
      });
    }, 250);
  }

  return (
    <div className="relative w-full max-w-sm">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <Input
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="Search prospects by name, email, phone, industry…"
        className="pl-8 pr-8"
      />
      {pending && (
        <Loader2 className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" />
      )}
    </div>
  );
}
