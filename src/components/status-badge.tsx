import { Badge } from "@/components/ui/badge";

export function StatusBadge({ status }: { status: string }) {
  const variant: "success" | "destructive" | "outline" | "warning" =
    status === "ACCEPTED"
      ? "success"
      : status === "REJECTED" || status === "EXPIRED"
      ? "destructive"
      : status === "DRAFT"
      ? "outline"
      : "warning";
  return (
    <Badge variant={variant} className="capitalize">
      {status.toLowerCase()}
    </Badge>
  );
}
