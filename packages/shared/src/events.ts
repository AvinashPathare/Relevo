/** NEP-297 events emitted by the escrow (standard "elivo"). */
export interface ElivoEvent {
  event: string;
  data: Record<string, unknown>;
}

export function parseElivoEvents(logs: string[]): ElivoEvent[] {
  const out: ElivoEvent[] = [];
  for (const line of logs) {
    if (!line.startsWith("EVENT_JSON:")) continue;
    try {
      const v = JSON.parse(line.slice("EVENT_JSON:".length));
      if (v.standard !== "elivo" || typeof v.event !== "string") continue;
      out.push({ event: v.event, data: (v.data?.[0] ?? {}) as Record<string, unknown> });
    } catch {
      // not JSON: ignore
    }
  }
  return out;
}
