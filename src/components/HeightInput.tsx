import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { cmToFtIn, ftInToCm, type Units } from "@/lib/units";

/** Height entry in the member's units; always reports centimetres (as a string) to the caller. */
export function HeightInput({
  cm,
  units,
  onChange,
}: {
  cm: string;
  units: Units;
  onChange: (cm: string) => void;
}) {
  const [ft, setFt] = useState("");
  const [inch, setInch] = useState("");
  useEffect(() => {
    if (units !== "imperial") return;
    if (!cm) {
      setFt("");
      setInch("");
      return;
    }
    const v = cmToFtIn(Number(cm));
    if (ftInToCm(Number(ft || 0), Number(inch || 0)) !== Number(cm)) {
      setFt(String(v.ft));
      setInch(String(v.inch));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cm, units]);
  if (units === "metric")
    return (
      <Input
        aria-label="Height (cm)"
        type="number"
        value={cm}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  const push = (f: string, i: string) =>
    onChange(f || i ? String(ftInToCm(Number(f || 0), Number(i || 0))) : "");
  return (
    <div className="flex gap-2">
      <Input
        aria-label="Height (feet)"
        type="number"
        placeholder="ft"
        value={ft}
        onChange={(e) => {
          setFt(e.target.value);
          push(e.target.value, inch);
        }}
      />
      <Input
        aria-label="Height (inches)"
        type="number"
        placeholder="in"
        value={inch}
        onChange={(e) => {
          setInch(e.target.value);
          push(ft, e.target.value);
        }}
      />
    </div>
  );
}
