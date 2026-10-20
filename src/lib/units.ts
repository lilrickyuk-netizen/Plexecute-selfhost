/** Display/input conversion only. Stored values stay metric (kg, cm, km, °C). Pure. */
export type Units = "metric" | "imperial";
export const unitsOf = (p: { units?: string | null } | null | undefined): Units =>
  p?.units === "imperial" ? "imperial" : "metric";

const LB = 2.20462262;
const r1 = (n: number) => Math.round(n * 10) / 10;

export const weightUnit = (u: Units) => (u === "imperial" ? "lb" : "kg");
export const kgToDisplay = (kg: number, u: Units) => (u === "imperial" ? r1(kg * LB) : r1(kg));
export const displayToKg = (v: number, u: Units) => (u === "imperial" ? v / LB : v);
export const fmtWeight = (kg: number | null | undefined, u: Units) =>
  kg == null ? "–" : `${kgToDisplay(Number(kg), u)} ${weightUnit(u)}`;

export function cmToFtIn(cm: number) {
  const totalIn = cm / 2.54;
  let ft = Math.floor(totalIn / 12);
  let inch = Math.round(totalIn - ft * 12);
  if (inch === 12) {
    ft += 1;
    inch = 0;
  }
  return { ft, inch };
}
export const ftInToCm = (ft: number, inch: number) => r1((ft * 12 + inch) * 2.54);
export function fmtHeight(cm: number | null | undefined, u: Units) {
  if (cm == null) return "–";
  if (u === "metric") return `${Math.round(cm)} cm`;
  const { ft, inch } = cmToFtIn(cm);
  return `${ft} ft ${inch} in`;
}

export const distanceUnit = (u: Units) => (u === "imperial" ? "mi" : "km");
export const kmToDisplay = (km: number, u: Units) =>
  u === "imperial" ? r1(km / 1.609344) : r1(km);
export const displayToKm = (v: number, u: Units) => (u === "imperial" ? v * 1.609344 : v);
export const fmtDistance = (km: number | null | undefined, u: Units) =>
  km == null ? "–" : `${kmToDisplay(Number(km), u)} ${distanceUnit(u)}`;

export const tempUnit = (u: Units) => (u === "imperial" ? "°F" : "°C");
export const cToDisplay = (c: number, u: Units) =>
  u === "imperial" ? r1((c * 9) / 5 + 32) : r1(c);
export const displayToC = (v: number, u: Units) => (u === "imperial" ? ((v - 32) * 5) / 9 : v);
export const fmtTemp = (c: number | null | undefined, u: Units) =>
  c == null ? "–" : `${cToDisplay(Number(c), u)}${tempUnit(u)}`;
