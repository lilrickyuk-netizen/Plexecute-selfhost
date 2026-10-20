export type ProgrammeSection = "strength" | "bodyweight" | "conditioning";

export function matchesTrainingSection(
  section: ProgrammeSection,
  programme: { goal: string; equipment: string },
) {
  if (section === "bodyweight") return programme.equipment === "bodyweight";
  if (section === "conditioning") return programme.goal === "conditioning";
  return programme.equipment !== "bodyweight" && programme.goal !== "conditioning";
}

export function showsActiveWorkout(
  section: ProgrammeSection,
  programme: { id: string; goal: string; equipment: string },
  session: { programme_id: string | null },
) {
  return session.programme_id === programme.id && matchesTrainingSection(section, programme);
}
