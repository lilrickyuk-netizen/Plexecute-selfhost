import { useServerFn } from "@tanstack/react-start";
import { WithVoice } from "@/components/VoiceInputButton";
import { useState } from "react";
import { CANCEL_REASONS, submitCancellationReason } from "@/lib/owner.functions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const LABELS: Record<(typeof CANCEL_REASONS)[number], string> = {
  too_expensive: "Too expensive",
  not_used_enough: "Did not use it enough",
  not_helpful: "Did not help enough",
  calling_not_useful: "Calling/accountability was not useful",
  too_complicated: "Too complicated",
  missing_feature: "Missing feature",
  technical_problem: "Technical problem",
  privacy_concern: "Privacy concern",
  other: "Other",
};

/** Optional, never blocks cancelling. Shown to members who are cancelling or have cancelled. */
export function CancelReason() {
  const send = useServerFn(submitCancellationReason);
  const [reason, setReason] = useState<(typeof CANCEL_REASONS)[number] | "">("");
  const [details, setDetails] = useState("");
  const [done, setDone] = useState(false);
  if (done)
    return <p className="mt-4 text-sm text-muted-foreground">Thanks — that helps us improve.</p>;
  return (
    <form
      className="mt-4 space-y-2 rounded-[14px] border border-border p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!reason) return;
        await send({ data: { reason, details: details || undefined } });
        setDone(true);
      }}
    >
      <p className="text-sm font-medium">Optional: why are you leaving?</p>
      <p className="text-xs text-muted-foreground">This doesn't affect your cancellation.</p>
      <div className="grid gap-1 sm:grid-cols-2">
        {CANCEL_REASONS.map((r) => (
          <label key={r} className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="radio"
              name="cancel-reason"
              value={r}
              checked={reason === r}
              onChange={() => setReason(r)}
            />
            {LABELS[r]}
          </label>
        ))}
      </div>
      <WithVoice value={details} onChange={(v) => setDetails(v)}>
        <Textarea
          aria-label="Anything else (optional)"
          maxLength={1000}
          value={details}
          onChange={(e) => setDetails(e.target.value)}
        />
      </WithVoice>
      <Button type="submit" size="sm" disabled={!reason}>
        Send
      </Button>
    </form>
  );
}
