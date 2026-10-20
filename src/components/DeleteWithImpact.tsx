import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export type ImpactPreview = {
  found: boolean;
  token: string;
  text: { removes: string[]; keeps: string[] };
};

/** Confirmation that lists exactly what a deletion removes and keeps, fetched fresh from the server. */
export function DeleteWithImpact({
  open,
  onOpenChange,
  title,
  load,
  run,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  load: () => Promise<ImpactPreview>;
  run: (token: string) => Promise<{ deleted: boolean; already_deleted?: boolean; error?: string }>;
  onDone: () => void;
}) {
  const [p, setP] = useState<ImpactPreview | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setP(null);
    load()
      .then(setP)
      .catch(() => toast.error("Couldn't check what this affects. Try again."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  async function go() {
    if (!p) return;
    setBusy(true);
    try {
      const r = await run(p.token);
      if (r.error) {
        toast.error("Something linked to it changed. Review the updated list.");
        setP(await load());
        return;
      }
      toast.success(r.already_deleted ? "Already deleted." : "Deleted.");
      onOpenChange(false);
      onDone();
    } catch {
      toast.error("Couldn't delete. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>This can't be undone.</AlertDialogDescription>
        </AlertDialogHeader>
        {!p ? (
          <p className="text-sm text-muted-foreground">Checking what this affects…</p>
        ) : !p.found ? (
          <p className="text-sm">Nothing to delete. It may already be gone.</p>
        ) : (
          <div className="space-y-3 text-sm" aria-label="Deletion impact">
            <div>
              <p className="font-medium">Will also be removed</p>
              {p.text.removes.length ? (
                <ul className="ml-4 list-disc">
                  {p.text.removes.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground">Nothing else.</p>
              )}
            </div>
            {p.text.keeps.length > 0 && (
              <div>
                <p className="font-medium">Kept as history</p>
                <ul className="ml-4 list-disc">
                  {p.text.keeps.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction
            disabled={!p?.found || busy}
            onClick={(e) => {
              e.preventDefault();
              go();
            }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Delete permanently
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
