import { Link } from "@tanstack/react-router";
import { ArrowRight, ExternalLink, MessageSquare, Play, Check } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useSetBlockStatus, type Block } from "@/lib/data";
import type { BriefCta, SessionBrief } from "@/lib/session-brief";

/** One action from an execution-ready session. Start/complete go through the normal execution rules. */
export function SessionCta({
  cta,
  block,
  brief,
  primary = false,
}: {
  cta: BriefCta;
  block: Block;
  brief: SessionBrief;
  primary?: boolean;
}) {
  const set = useSetBlockStatus();
  const qc = useQueryClient();
  const variant = primary ? "default" : "outline";
  const cls = primary ? "w-full" : "rounded-[10px]";
  const size = primary ? "default" : "sm";
  async function run(action: "start" | "complete") {
    try {
      await set.mutateAsync({ blockId: block.id, action } as never);
      qc.invalidateQueries({ queryKey: ["block", block.id] });
      toast.success(action === "start" ? "Session started." : "Session complete.");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  // Starting a session from its real destination also records that it started.
  const startFirst = () => {
    if (
      ["planned", "scheduled", "upcoming", "due", "acknowledged", "snoozed"].includes(block.status)
    )
      void set.mutateAsync({ blockId: block.id, action: "start" } as never).catch(() => {});
  };
  switch (cta.type) {
    case "href":
      return (
        <Button asChild variant={variant} size={size} className={cls}>
          <a
            href={cta.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={primary ? startFirst : undefined}
          >
            {cta.label} <ExternalLink />
          </a>
        </Button>
      );
    case "route":
      return (
        <Button asChild variant={variant} size={size} className={cls}>
          <Link
            to={cta.to as never}
            search={(cta.search ?? {}) as never}
            onClick={primary ? startFirst : undefined}
          >
            {cta.label} <ArrowRight />
          </Link>
        </Button>
      );
    case "coach":
      return (
        <Button asChild variant={variant} size={size} className={cls}>
          <Link to="/app/coach" search={{ session: brief.blockId }}>
            <MessageSquare /> {cta.label}
          </Link>
        </Button>
      );
    case "start":
      return (
        <Button
          variant={variant}
          size={size}
          className={cls}
          disabled={set.isPending}
          onClick={() => run("start")}
        >
          <Play /> {cta.label}
        </Button>
      );
    case "complete":
      return (
        <Button
          variant={variant}
          size={size}
          className={cls}
          disabled={set.isPending}
          onClick={() => run("complete")}
        >
          <Check /> {cta.label}
        </Button>
      );
  }
}
