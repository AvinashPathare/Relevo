import { describe, expect, it } from "vitest";
import { parseElivoEvents } from "../src/events.ts";

describe("parseElivoEvents", () => {
  it("keeps only elivo NEP-297 events", () => {
    const logs = [
      'EVENT_JSON:{"standard":"elivo","version":"1.0.0","event":"payout_assigned","data":[{"batch_id":"0","payout_id":1}]}',
      'EVENT_JSON:{"standard":"nep141","version":"1.0.0","event":"ft_transfer","data":[{}]}',
      "plain log",
      "EVENT_JSON:{not json",
    ];
    expect(parseElivoEvents(logs)).toEqual([
      { event: "payout_assigned", data: { batch_id: "0", payout_id: 1 } },
    ]);
  });
});
