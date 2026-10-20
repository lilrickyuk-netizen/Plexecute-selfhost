import { describe, it, expect } from "vitest";
import { requestIntent, capabilityFor } from "../src/lib/life-intelligence";

describe("requestIntent", () => {
  const q = [
    "Can you book taxis?",
    "If I give you the details can you book me a taxi?",
    "So if you have my location can you book me a taxi from my location?",
    "Are you able to phone a taxi company for me?",
    "Is it possible for Plexecute to order a cab?",
    "How does booking a taxi work?",
    "What can you book?",
    "Could you book a table if I needed one?",
  ];
  const r = [
    "Book me a taxi to the station",
    "Please order a taxi from my location",
    "Can you book me a taxi now",
    "Can you book me a taxi to the airport tomorrow at 6am",
    "Could you book a table for 4 people tonight",
    "Yes, go ahead",
    "Ok book it",
    "I need a taxi to Leeds station",
  ];
  for (const t of q)
    it(`question: ${t}`, () => expect(requestIntent(t)).toBe("capability_question"));
  for (const t of r) it(`request: ${t}`, () => expect(requestIntent(t)).toBe("action_request"));
  it("taxis are bookable on Execute, not unsupported", () => {
    expect(capabilityFor("order me a taxi", "execute").cls).toBe("PLEXECUTE_CAN_BOOK");
  });
});
