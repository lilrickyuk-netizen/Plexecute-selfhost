import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { getAutoAdapt, setAutoAdapt } from "@/lib/auto-adapt.functions";
import {
  AUTO_ADAPT_LABELS,
  AUTO_ADAPT_PERMISSIONS,
  NEVER_AUTOMATIC,
  type AutoAdaptPermission,
} from "@/lib/auto-adapt";

export function AutoAdaptSettings() {
  const qc = useQueryClient();
  const load = useServerFn(getAutoAdapt);
  const save = useServerFn(setAutoAdapt);
  const { data: perms } = useQuery({ queryKey: ["auto-adapt"], queryFn: () => load() });

  async function toggle(permission: AutoAdaptPermission, enabled: boolean) {
    try {
      await save({ data: { permission, enabled } });
      await qc.invalidateQueries({ queryKey: ["auto-adapt"] });
      toast.success(enabled ? "Allowed" : "Now needs your approval");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <section
      id="auto-adapt"
      className="scroll-mt-20 space-y-4 rounded-[20px] border border-border bg-card p-6"
    >
      <div>
        <h2 className="font-display text-lg font-semibold">Automatic changes</h2>
        <p className="text-sm text-muted-foreground">
          Choose what Plexecute may change without asking. Anything switched off arrives as a
          suggestion for you to approve.
        </p>
      </div>
      {AUTO_ADAPT_PERMISSIONS.map((k) => (
        <div key={k} className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium">{AUTO_ADAPT_LABELS[k].title}</p>
            <p className="text-xs text-muted-foreground">{AUTO_ADAPT_LABELS[k].detail}</p>
          </div>
          <Switch
            aria-label={AUTO_ADAPT_LABELS[k].title}
            checked={perms?.[k] ?? false}
            disabled={!perms}
            onCheckedChange={(v) => toggle(k, v)}
          />
        </div>
      ))}
      <div className="rounded-[12px] border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
        Always needs you: {NEVER_AUTOMATIC.join(", ")}.
      </div>
    </section>
  );
}
