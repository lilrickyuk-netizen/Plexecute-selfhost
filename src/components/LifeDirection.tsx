import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  VISION_AREAS,
  VISION_QUESTION,
  VISION_HELP,
  normaliseVision,
  type VisionObjective,
} from "@/lib/intake";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WithVoice } from "@/components/VoiceInputButton";

/** The member's confirmed 5-year direction (Life Twin fact five_year_vision). Editing never changes active goals. */
export function LifeDirection({ activeGoals }: { activeGoals: number }) {
  const qc = useQueryClient();
  const { data: fact } = useQuery({
    queryKey: ["twin", "five_year_vision"],
    queryFn: async () => {
      const { data } = await supabase
        .from("life_twin_facts")
        .select("id,fact_value,version,is_locked")
        .eq("fact_key", "five_year_vision")
        .is("valid_until", null)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
  });
  const v = normaliseVision({ ...(fact?.fact_value as object), answered: true });
  const [edit, setEdit] = useState<VisionObjective[] | null>(null);
  const [add, setAdd] = useState("");
  const [saved, setSaved] = useState(false);

  async function save(objectives: VisionObjective[]) {
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("life_twin_facts").insert({
      user_id: u.user!.id,
      domain: "identity",
      fact_key: "five_year_vision",
      fact_value: { summary: v.summary, objectives } as never,
      source: "USER_ASSERTED",
      source_ref: "goals_life_direction",
      confidence: 1,
      version: (fact?.version ?? 0) + 1,
      supersedes_id: fact?.id ?? null,
      is_locked: fact?.is_locked ?? false,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    if (fact)
      await supabase
        .from("life_twin_facts")
        .update({ valid_until: new Date().toISOString() })
        .eq("id", fact.id);
    setEdit(null);
    setSaved(true);
    toast.success("Life direction saved.");
    qc.invalidateQueries({ queryKey: ["twin"] });
  }

  const list = edit ?? v.objectives;
  return (
    <section className="mt-8 rounded-[14px] border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-medium">Life direction · 5 years</h2>
        {!edit && (
          <button className="text-xs text-primary" onClick={() => setEdit(v.objectives)}>
            {v.objectives.length ? "Edit" : "Add"}
          </button>
        )}
      </div>
      {!v.objectives.length && !edit && (
        <p className="mt-1 text-sm text-muted-foreground">
          {VISION_QUESTION} {VISION_HELP}
        </p>
      )}
      <ul className="mt-3 space-y-2">
        {list.map((o, i) => (
          <li key={i} className="flex items-center gap-2 text-sm">
            {edit ? (
              <>
                <select
                  aria-label="Area"
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  value={o.area}
                  onChange={(e) =>
                    setEdit(
                      list.map((x, j) =>
                        j === i ? { ...x, area: e.target.value as VisionObjective["area"] } : x,
                      ),
                    )
                  }
                >
                  {VISION_AREAS.map((a) => (
                    <option key={a} value={a}>
                      {a.replace("_", " ")}
                    </option>
                  ))}
                </select>
                <Input
                  aria-label={`Objective ${i + 1}`}
                  value={o.text}
                  onChange={(e) =>
                    setEdit(list.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))
                  }
                />
                <button
                  aria-label={`Remove ${o.text}`}
                  onClick={() => setEdit(list.filter((_, j) => j !== i))}
                >
                  <Trash2 className="h-4 w-4 text-muted-foreground" />
                </button>
              </>
            ) : (
              <>
                <span className="flex-1">
                  <span className="text-muted-foreground capitalize">
                    {o.area.replace("_", " ")}:
                  </span>{" "}
                  {o.text}
                </span>
                <Link to="/app/pathway" search={{ goal: o.text }} className="text-xs text-primary">
                  Start working on this
                </Link>
              </>
            )}
          </li>
        ))}
      </ul>
      {edit && (
        <div className="mt-3 space-y-2">
          <WithVoice value={add} onChange={setAdd}>
            <Input
              aria-label="Add a 5-year objective"
              placeholder="e.g. Own my own home"
              value={add}
              onChange={(e) => setAdd(e.target.value)}
            />
          </WithVoice>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!add.trim()}
              onClick={() => {
                setEdit([...list, { area: "other", text: add.trim().slice(0, 200) }]);
                setAdd("");
              }}
            >
              Add
            </Button>
            <Button
              size="sm"
              className="rounded-[10px]"
              onClick={() => save(list.filter((o) => o.text.trim()))}
            >
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEdit(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {saved && activeGoals > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          Your current goals were kept as they are. If any no longer fit this direction, pause,
          change or delete them below.
        </p>
      )}
    </section>
  );
}
