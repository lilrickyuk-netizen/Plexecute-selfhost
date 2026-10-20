import { describe as d2, it as i2, expect as e2 } from "vitest";
import { assessRecovery as ar } from "../src/lib/recovery-state";
d2("recovery v2", () => {
  const c = { sleep_quality: 4, energy: 4, soreness: 2, stress: 2 };
  i2("ill or injured is RED", () =>
    e2(ar({ checkin: { ...c, ill_or_injured: true } }).state).toBe("RED"),
  );
  i2("sleep below target is AMBER", () =>
    e2(ar({ checkin: c, sleepHours: 7, sleepTargetHours: 8 }).state).toBe("AMBER"),
  );
  i2("wearable alone never RED", () =>
    e2(ar({ checkin: c, restingHrDelta: 20 }).state).toBe("AMBER"),
  );
  i2("load is noted, not scored", () => {
    const a = ar({ checkin: c, recentHardSessions: 4, executionMissed48h: 2 });
    e2(a.state).toBe("GREEN");
    e2(a.notes.length).toBe(2);
  });
});
