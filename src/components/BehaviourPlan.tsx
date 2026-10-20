import { useState } from "react";
import { WithVoice } from "@/components/VoiceInputButton";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  addIntention,
  addReflection,
  getBehaviour,
  removeIntention,
} from "@/lib/behaviour.functions";
import { INTENTION_COPY, INTENTION_KINDS, REASON_LABEL, type IntentionKind } from "@/lib/behaviour";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function BehaviourPlan({ goalId }: { goalId: string }) {
  const qc = useQueryClient();
  const get = useServerFn(getBehaviour);
  const add = useServerFn(addIntention);
  const rm = useServerFn(removeIntention);
  const reflect = useServerFn(addReflection);
  const key = ["behaviour", goalId];
  const { data } = useQuery({ queryKey: key, queryFn: () => get({ data: { goalId } }) });
  const [kind, setKind] = useState<IntentionKind>("intention");
  const [when, setWhen] = useState("");
  const [then, setThen] = useState("");
  const [r, setR] = useState({ wentWell: "", gotInWay: "", changeNext: "" });
  const refresh = () => qc.invalidateQueries({ queryKey: key });

  return (
    <section className="space-y-4 rounded-[16px] border border-border p-5">
      <div>
        <h2 className="text-lg font-semibold">Making it happen</h2>
        <p className="text-sm text-muted-foreground">
          Plans you choose for when, what gets in the way and how to prepare. Missed sessions are
          useful information, not failure.
        </p>
      </div>

      {data?.pattern ? (
        <p className="rounded-[10px] bg-raised p-3 text-sm">
          Most common reason for missed sessions:{" "}
          <strong>{REASON_LABEL[data.pattern.reason]}</strong> ({data.pattern.count} of{" "}
          {data.pattern.sample} with a reason, last {data.windowDays} days). An obstacle plan for
          this could help.
        </p>
      ) : data && data.missedCount > 0 ? (
        <p className="text-xs text-muted-foreground">
          {data.missedCount} missed session{data.missedCount === 1 ? "" : "s"} with a reason in the
          last {data.windowDays} days. A pattern shows once there are at least 3.
        </p>
      ) : null}

      <ul className="space-y-2">
        {data?.intentions.map((i) => (
          <li
            key={i.id}
            className="flex items-start justify-between gap-3 rounded-[10px] border border-border p-3 text-sm"
          >
            <div>
              <div className="text-xs text-muted-foreground">
                {INTENTION_COPY[i.kind as IntentionKind].title}
              </div>
              <div>
                <strong>{i.when_text}</strong> → {i.then_text}
              </div>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                await rm({ data: { id: i.id } });
                refresh();
              }}
            >
              Remove
            </Button>
          </li>
        ))}
      </ul>

      <div className="space-y-2">
        <div className="flex flex-wrap gap-2" role="radiogroup">
          {INTENTION_KINDS.map((k) => (
            <Button
              key={k}
              size="sm"
              variant={kind === k ? "default" : "outline"}
              role="radio"
              aria-checked={kind === k}
              onClick={() => setKind(k)}
            >
              {INTENTION_COPY[k].title}
            </Button>
          ))}
        </div>
        <Input
          value={when}
          maxLength={200}
          placeholder={INTENTION_COPY[kind].when}
          onChange={(e) => setWhen(e.target.value)}
        />
        <Input
          value={then}
          maxLength={200}
          placeholder={INTENTION_COPY[kind].then}
          onChange={(e) => setThen(e.target.value)}
        />
        <Button
          size="sm"
          disabled={!when.trim() || !then.trim()}
          onClick={async () => {
            try {
              await add({ data: { goalId, kind, when, then } });
              setWhen("");
              setThen("");
              refresh();
              toast.success("Plan saved");
            } catch (e) {
              toast.error((e as Error).message);
            }
          }}
        >
          Save plan
        </Button>
      </div>

      <div className="space-y-2 border-t border-border pt-4">
        <h3 className="font-medium">Reflect</h3>
        <WithVoice value={r.wentWell} onChange={(v) => setR({ ...r, wentWell: v })}>
          <Textarea
            maxLength={500}
            placeholder="What went well?"
            value={r.wentWell}
            onChange={(e) => setR({ ...r, wentWell: e.target.value })}
          />
        </WithVoice>
        <WithVoice value={r.gotInWay} onChange={(v) => setR({ ...r, gotInWay: v })}>
          <Textarea
            maxLength={500}
            placeholder="What got in the way?"
            value={r.gotInWay}
            onChange={(e) => setR({ ...r, gotInWay: e.target.value })}
          />
        </WithVoice>
        <WithVoice value={r.changeNext} onChange={(v) => setR({ ...r, changeNext: v })}>
          <Textarea
            maxLength={500}
            placeholder="What will you change next?"
            value={r.changeNext}
            onChange={(e) => setR({ ...r, changeNext: e.target.value })}
          />
        </WithVoice>
        <Button
          size="sm"
          variant="outline"
          disabled={!r.wentWell.trim() && !r.gotInWay.trim() && !r.changeNext.trim()}
          onClick={async () => {
            try {
              await reflect({ data: { goalId, ...r } });
              setR({ wentWell: "", gotInWay: "", changeNext: "" });
              refresh();
              toast.success("Reflection saved");
            } catch (e) {
              toast.error((e as Error).message);
            }
          }}
        >
          Save reflection
        </Button>
        {data?.reflections.map((x) => (
          <div key={x.id} className="rounded-[10px] bg-raised p-3 text-xs">
            <div className="text-muted-foreground">
              {new Date(x.created_at).toLocaleDateString("en-GB")}
            </div>
            {x.went_well && <div>Went well: {x.went_well}</div>}
            {x.got_in_way && <div>Got in the way: {x.got_in_way}</div>}
            {x.change_next && <div>Next: {x.change_next}</div>}
          </div>
        ))}
      </div>
    </section>
  );
}
