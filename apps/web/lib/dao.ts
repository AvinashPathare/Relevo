/** Router's GET /batches/:id/dao-proposal. */
export interface DaoProposal {
  id: number;
  status: string;
  kind: object;
  proposer: string;
  votes: Record<string, string>;
}

export async function fetchDaoProposal(
  draftId: string,
): Promise<{ proposal: DaoProposal | null; council: string[]; unknownDraft?: boolean }> {
  const r = await fetch(`/router/batches/${encodeURIComponent(draftId)}/dao-proposal`);
  if (r.status === 404) {
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    return { proposal: null, council: [], unknownDraft: j.error === "unknown_draft" };
  }
  if (!r.ok) throw new Error(`dao-proposal: HTTP ${r.status}`);
  const { council, ...proposal } = (await r.json()) as DaoProposal & { council: string[] };
  return { proposal, council };
}
