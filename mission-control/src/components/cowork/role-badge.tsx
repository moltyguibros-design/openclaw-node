import { Crown, Wrench, Eye, Shield, User } from "lucide-react";

const ROLES = [
  { value: "lead", label: "Lead", icon: Crown, color: "text-purple-400", bg: "bg-purple-400/10" },
  { value: "implementer", label: "Implementer", icon: Wrench, color: "text-cyan-400", bg: "bg-cyan-400/10" },
  { value: "reviewer", label: "Reviewer", icon: Eye, color: "text-amber-400", bg: "bg-amber-400/10" },
  { value: "auditor", label: "Auditor", icon: Shield, color: "text-red-400", bg: "bg-red-400/10" },
  { value: "worker", label: "Worker", icon: User, color: "text-zinc-400", bg: "bg-zinc-400/10" },
] as const;

const ROLE_MAP = new Map(ROLES.map((r) => [r.value as string, r]));

export function RoleBadge({ role }: { role: string }) {
  const def = ROLE_MAP.get(role);
  if (!def) {
    return (
      <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-zinc-800 text-zinc-300">
        {role}
      </span>
    );
  }
  const Icon = def.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${def.bg} ${def.color}`}
    >
      <Icon className="h-3 w-3" />
      {def.label}
    </span>
  );
}
