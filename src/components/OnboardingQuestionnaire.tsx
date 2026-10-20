import { useState } from "react";
import { Check, ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  onboardingQuestions,
  onboardingTranscript,
  toggleOnboardingAnswer,
} from "@/lib/onboarding-questionnaire";

export function OnboardingQuestionnaire({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (text: string, visionUnsure: boolean) => void;
}) {
  const [a, setA] = useState<Record<string, string[]>>({});
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [goal, setGoal] = useState("");
  const [i, setI] = useState(0);
  const questions = onboardingQuestions(a);
  const q = questions[Math.min(i, questions.length - 1)];
  if (!q) return null;
  const picked = a[q.id] ?? [];
  const done = i >= questions.length;
  const needsCustom = picked.includes("My own answer");
  const valid = picked.length > 0 && (!needsCustom || !!custom[q.id]?.trim());
  const toggle = (o: string) => {
    if (busy) return;
    setA((answers) => ({ ...answers, [q.id]: toggleOnboardingAnswer(answers[q.id] ?? [], o, q) }));
  };
  function submit() {
    if (busy || !goal.trim()) return;
    onSubmit(
      onboardingTranscript(a, custom, goal),
      (a["vision"] ?? []).some(
        (v) => v === "I'm not sure yet" || v === "I'd rather leave this for later",
      ),
    );
  }
  return (
    <div className="mt-6 space-y-5" data-testid="onboarding-questionnaire" aria-busy={busy}>
      <p className="text-xs text-muted-foreground">
        Question {Math.min(i + 1, questions.length + 1)} of {questions.length + 1}
      </p>
      {!done ? (
        <>
          <h2 className="text-xl font-semibold">{q.q}</h2>
          {q.multi && <p className="text-xs text-muted-foreground">Choose all that apply.</p>}
          <div className="grid gap-2 sm:grid-cols-2">
            {[...q.options, "My own answer"].map((o) => (
              <Button
                key={o}
                type="button"
                variant="outline"
                disabled={busy}
                aria-pressed={picked.includes(o)}
                onClick={() => toggle(o)}
                className={`h-auto min-h-11 justify-start whitespace-normal rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${picked.includes(o) ? "border-primary bg-primary/10 text-foreground" : "border-border hover:border-primary/50"}`}
              >
                <span className="flex-1">{o}</span>
                {picked.includes(o) && (
                  <Check className="size-4 shrink-0 text-primary" aria-hidden />
                )}
              </Button>
            ))}
          </div>
          {needsCustom && (
            <Input
              aria-label={q.customLabel ?? "Your answer"}
              type={q.time ? "time" : "text"}
              maxLength={300}
              disabled={busy}
              value={custom[q.id] ?? ""}
              onChange={(e) => setCustom((values) => ({ ...values, [q.id]: e.target.value }))}
              placeholder={q.customLabel}
            />
          )}
          <div className="flex items-center gap-2 border-t border-border pt-4">
            {i > 0 && (
              <Button variant="ghost" disabled={busy} onClick={() => setI(i - 1)}>
                <ArrowLeft className="size-4" />
                Back
              </Button>
            )}
            <div className="flex-1" />
            <Button
              disabled={busy || !valid}
              onClick={() => setI(Math.min(i + 1, questions.length))}
            >
              Next
              <ArrowRight className="size-4" />
            </Button>
          </div>
        </>
      ) : (
        <>
          <h2 className="text-xl font-semibold">
            What is the first goal you want to turn into a plan?
          </h2>
          <Input
            aria-label="Main goal"
            maxLength={200}
            disabled={busy}
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="e.g. Launch a business, write a book, learn Spanish"
          />
          <div className="flex items-center gap-2 border-t border-border pt-4">
            <Button variant="ghost" disabled={busy} onClick={() => setI(i - 1)}>
              <ArrowLeft className="size-4" />
              Back
            </Button>
            <div className="flex-1" />
            <Button disabled={busy || !goal.trim()} onClick={submit}>
              {busy ? "Understanding your answers…" : "Review my answers"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
