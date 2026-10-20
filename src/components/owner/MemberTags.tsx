import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ownerMemberTags, ownerTagMember } from "@/lib/owner.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Owner-only custom tags used to build cohorts. */
export function MemberTags({ code }: { code: string }) {
  const list = useServerFn(ownerMemberTags);
  const tag = useServerFn(ownerTagMember);
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["owner-tags", code],
    queryFn: () => list({ data: { code } }),
  });
  const [t, setT] = useState("");
  const run = async (value: string, remove?: boolean) => {
    await tag({ data: { code, tag: value, remove } });
    setT("");
    qc.invalidateQueries({ queryKey: ["owner-tags", code] });
    qc.invalidateQueries({ queryKey: ["owner-cohorts"] });
  };
  return (
    <section className="rounded-[14px] border border-border bg-card p-4">
      <h2 className="text-sm font-medium">Cohort tags</h2>
      <div className="mt-2 flex flex-wrap gap-2">
        {(data ?? []).map((x) => (
          <button
            key={x}
            onClick={() => run(x, true)}
            className="rounded-full border border-border px-2 py-0.5 text-xs"
            aria-label={`Remove tag ${x}`}
          >
            {x} ×
          </button>
        ))}
        {data?.length === 0 && <span className="text-xs text-muted-foreground">No tags.</span>}
      </div>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (t.trim()) run(t.trim());
        }}
      >
        <Input
          aria-label="New tag"
          value={t}
          maxLength={40}
          onChange={(e) => setT(e.target.value)}
          className="h-9 w-48"
        />
        <Button size="sm" type="submit">
          Add tag
        </Button>
      </form>
    </section>
  );
}
