import { Input } from "@/components/ui/input";
import { WithVoice } from "@/components/VoiceInputButton";
import { DOMAINS } from "@/lib/scheduler";

export type DraftGoal = {
  title: string;
  domain: string;
  weekly_minutes: number;
  session_minutes: number;
  preferred_time: string;
  why: string;
};

export function GoalEditor({
  goal,
  onChange,
  onRemove,
}: {
  goal: DraftGoal;
  onChange: (g: DraftGoal) => void;
  onRemove?: (() => void) | undefined;
}) {
  return (
    <div className="space-y-3 rounded-[14px] border border-border bg-raised p-4">
      <WithVoice
        value={goal.title}
        onChange={(v) => onChange({ ...goal, title: v })}
        label="Say the goal"
      >
        <Input
          aria-label="Goal name"
          value={goal.title}
          onChange={(e) => onChange({ ...goal, title: e.target.value })}
          placeholder="e.g. Get stronger, learn Spanish"
        />
      </WithVoice>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <select
          aria-label="Life area"
          value={goal.domain}
          onChange={(e) => onChange({ ...goal, domain: e.target.value })}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        >
          {DOMAINS.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
        <label className="text-xs text-muted-foreground">
          Min/week
          <Input
            type="number"
            min={10}
            value={goal.weekly_minutes}
            onChange={(e) => onChange({ ...goal, weekly_minutes: Number(e.target.value) })}
          />
        </label>
        <label className="text-xs text-muted-foreground">
          Min/session
          <Input
            type="number"
            min={10}
            value={goal.session_minutes}
            onChange={(e) => onChange({ ...goal, session_minutes: Number(e.target.value) })}
          />
        </label>
        <select
          aria-label="Preferred time"
          value={goal.preferred_time}
          onChange={(e) => onChange({ ...goal, preferred_time: e.target.value })}
          className="h-9 self-end rounded-md border border-input bg-background px-2 text-sm"
        >
          <option value="any">Any time</option>
          <option value="morning">Morning</option>
          <option value="midday">Midday</option>
          <option value="evening">Evening</option>
        </select>
      </div>
      <WithVoice value={goal.why} onChange={(v) => onChange({ ...goal, why: v })}>
        <Input
          value={goal.why}
          onChange={(e) => onChange({ ...goal, why: e.target.value })}
          placeholder="Why does this matter? (optional)"
        />
      </WithVoice>
      {onRemove && (
        <button onClick={onRemove} className="text-xs text-muted-foreground hover:text-destructive">
          Remove
        </button>
      )}
    </div>
  );
}
