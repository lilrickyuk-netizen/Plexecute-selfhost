import learningImage from "@/assets/member-learning.jpg";
import { FeatureHeader } from "@/components/FeatureHeader";
import { createFileRoute } from "@tanstack/react-router";
import { VoiceInputButton, WithVoice } from "@/components/VoiceInputButton";
import { appendTranscript } from "@/lib/voice-input";
import { useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { findLearningResources, listLearningTopics } from "@/lib/learn-resources.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ExternalLink, Search, BookOpen } from "lucide-react";

export const Route = createFileRoute("/_authenticated/app/learning")({
  head: () => ({
    meta: [
      { title: "Learning — Plexecute" },
      {
        name: "description",
        content: "Pick any subject and get real courses, books and resources with links.",
      },
      { property: "og:title", content: "Learning — Plexecute" },
      {
        property: "og:description",
        content: "Pick any subject and get real courses, books and resources with links.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Learning,
});

type Resource = {
  title: string;
  type: string;
  url: string;
  provider: string;
  why: string;
  free?: boolean;
};
type Topic = {
  id: string;
  subject: string;
  level: string;
  summary: string | null;
  resources: Resource[];
  created_at: string;
};

const TYPE_LABEL: Record<string, string> = {
  course: "Course",
  book: "Book",
  article: "Article",
  video: "Video",
  webinar: "Webinar",
  practice: "Practice",
  other: "Resource",
};

function ResourceCard({ r }: { r: Resource }) {
  return (
    <a
      href={r.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-start gap-3 rounded-[14px] border border-border bg-card p-4 hover:border-primary/50"
    >
      <div className="flex-1">
        <div className="font-medium">{r.title}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {TYPE_LABEL[r.type] ?? "Resource"}
          {r.provider ? ` · ${r.provider}` : ""}
          {r.free ? " · Free" : ""}
        </div>
        {r.why && <div className="mt-1 text-sm text-muted-foreground">{r.why}</div>}
      </div>
      <ExternalLink className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
    </a>
  );
}

function Learning() {
  const qc = useQueryClient();
  const find = useServerFn(findLearningResources);
  const list = useServerFn(listLearningTopics);
  const [subject, setSubject] = useState("");
  const [level, setLevel] = useState<"beginner" | "intermediate" | "advanced">("beginner");
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<{ summary: string | null; resources: Resource[] } | null>(
    null,
  );

  const { data: topics = [] } = useQuery<Topic[]>({
    queryKey: ["learning-topics"],
    queryFn: () => list() as Promise<Topic[]>,
  });

  async function go() {
    if (!subject.trim() || busy) return;
    setBusy(true);
    setFresh(null);
    try {
      const out = (await find({ data: { subject: subject.trim(), level } })) as {
        summary: string | null;
        resources: Resource[];
      };
      setFresh(out);
      qc.invalidateQueries({ queryKey: ["learning-topics"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The search failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <FeatureHeader
        title="Learning"
        icon={BookOpen}
        description="Pick any subject and get free online courses, free books, learning materials and webinars, found live on the web."
      />
      <div className="member-training-cover mt-5">
        <img
          src={learningImage}
          width={1536}
          height={1024}
          alt="Books, notebook and laptop on a study desk"
        />
      </div>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <div className="flex-1">
          <WithVoice
            value={subject}
            onChange={(v) => setSubject(v.slice(0, 200))}
            label="Say a subject"
          >
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && go()}
              placeholder="What do you want to learn? e.g. photography, Spanish, Excel"
              maxLength={200}
            />
          </WithVoice>
        </div>
        <select
          value={level}
          onChange={(e) => setLevel(e.target.value as typeof level)}
          className="rounded-[10px] border border-border bg-card px-3 py-2 text-sm"
          aria-label="Level"
        >
          <option value="beginner">Beginner</option>
          <option value="intermediate">Intermediate</option>
          <option value="advanced">Advanced</option>
        </select>
        <Button className="rounded-[10px]" onClick={go} disabled={busy || !subject.trim()}>
          <Search className="mr-2 h-4 w-4" />
          {busy ? "Searching…" : "Find resources"}
        </Button>
      </div>

      {fresh && (
        <div className="mt-8">
          <h2 className="text-lg font-medium">Results</h2>
          {fresh.summary && <p className="mt-2 text-sm text-muted-foreground">{fresh.summary}</p>}
          <div className="mt-3 space-y-3">
            {fresh.resources.map((r) => (
              <ResourceCard key={r.url} r={r} />
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Links are found live on the web and verified against the pages they came from. Check
            each provider for current prices and availability.
          </p>
        </div>
      )}

      {topics.length > 0 && (
        <div className="mt-10">
          <h2 className="text-lg font-medium">Your past searches</h2>
          <div className="mt-3 space-y-6">
            {topics.map((t) => (
              <div key={t.id}>
                <div className="text-sm font-medium">
                  {t.subject} <span className="text-muted-foreground">· {t.level}</span>
                </div>
                <div className="mt-2 space-y-2">
                  {(t.resources as Resource[]).map((r) => (
                    <ResourceCard key={r.url} r={r} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
