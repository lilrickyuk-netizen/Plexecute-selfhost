// Coach may only plan with equipment the member has actually mentioned (or set in their programme).
export const EQUIPMENT_WORDS: [string, RegExp][] = [
  ["dumbbells", /\bdumb ?bells?\b/i],
  ["kettlebell", /\bkettle ?bells?\b/i],
  ["barbell", /\bbar ?bells?\b|\bsquat rack\b/i],
  ["resistance bands", /\b(resistance )?bands?\b/i],
  ["bench", /\bbench\b/i],
  ["pull-up bar", /\bpull[- ]?up bar\b|\bchin[- ]?up bar\b/i],
  ["gym machines", /\b(cable|machine|leg press|lat pulldown|smith)\b/i],
];
const GYM = /\b(the )?gym\b|\bweights\b|\bfitness cent(re|er)\b/i;

/** Equipment mentioned in the member's own words. "gym" means full gym access. */
export function equipmentFromText(text: string): { gym: boolean; items: string[] } {
  const t = String(text ?? "");
  return { gym: GYM.test(t), items: EQUIPMENT_WORDS.filter(([, r]) => r.test(t)).map(([k]) => k) };
}

/** Equipment that a planned task depends on but the member never mentioned. */
export function unmentionedEquipment(
  taskText: string,
  memberHistory: string,
  programmeEquipment: string | null,
): string[] {
  if (programmeEquipment === "gym") return [];
  const known = equipmentFromText(memberHistory);
  if (known.gym) return [];
  const needed = equipmentFromText(taskText).items.filter(
    (k) => k !== "pull-up bar" || !/\bpull[- ]?ups?\b/i.test(memberHistory),
  );
  return needed.filter((k) => !known.items.includes(k));
}

/** Pick the equipment level the engine may use: never more than the member has stated. */
export function allowedEquipment(
  requested: string | null,
  memberHistory: string,
  programmeEquipment: string | null,
): "gym" | "home" | "bodyweight" {
  const known = equipmentFromText(memberHistory);
  const ceiling =
    programmeEquipment === "gym" || known.gym
      ? "gym"
      : programmeEquipment === "home" || known.items.length
        ? "home"
        : "bodyweight";
  const order = ["bodyweight", "home", "gym"];
  const want = order.includes(String(requested)) ? String(requested) : ceiling;
  return (order.indexOf(want) <= order.indexOf(ceiling) ? want : ceiling) as never;
}
