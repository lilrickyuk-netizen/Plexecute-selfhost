import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PlayCircle, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getExerciseDemo } from "@/lib/exercise-demo.functions";
import { DEMO_SAFETY, DEMO_SPECS } from "@/lib/exercise-demo";

/** Optional demonstration for one prescribed exercise. Looked up only when tapped. */
export function ExerciseDemoButton({ exerciseKey, name }: { exerciseKey: string; name: string }) {
  const [open, setOpen] = useState(false);
  const get = useServerFn(getExerciseDemo);
  const q = useQuery({
    queryKey: ["exercise-demo", exerciseKey],
    queryFn: () => get({ data: { exerciseKey } }),
    enabled: open,
    staleTime: 3600_000,
    retry: false,
  });
  if (!DEMO_SPECS[exerciseKey]) return null;
  const d = q.data?.demo;
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <PlayCircle className="mr-1 h-4 w-4" /> Watch demonstration
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{name}: demonstration</DialogTitle>
          </DialogHeader>
          {q.isLoading && (
            <p className="text-sm text-muted-foreground">Finding a checked demonstration…</p>
          )}
          {q.error && <p className="text-sm text-destructive">{(q.error as Error).message}</p>}
          {q.data && !d && (
            <p className="text-sm text-muted-foreground">
              No demonstration that matches this exact exercise passed our checks yet. Use the
              Technique notes instead.
            </p>
          )}
          {d && (
            <div className="space-y-2">
              {d.embeddable && (
                <div className="aspect-video overflow-hidden rounded-xl bg-muted">
                  <iframe
                    className="h-full w-full"
                    src={`https://www.youtube-nocookie.com/embed/${d.videoId}`}
                    title={d.title}
                    allow="encrypted-media; picture-in-picture"
                    allowFullScreen
                  />
                </div>
              )}
              <p className="text-sm font-medium">{d.title}</p>
              <p className="text-xs text-muted-foreground">
                {d.creator} · YouTube ·{" "}
                {d.seconds
                  ? `${Math.max(1, Math.round(d.seconds / 60))} min`
                  : "length not confirmed"}{" "}
                · {d.equipment} · checked {new Date(d.verifiedAt).toLocaleDateString()}
              </p>
              <a
                href={d.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-sm underline"
              >
                Open on YouTube <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Optional. Your workout stays the same whether or not you watch. {DEMO_SAFETY}
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}
