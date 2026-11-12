/** Find the Sputnik DAO proposal that funds a draft, by the description buildFundingProposal writes. */
export interface DaoProposal {
  id: number;
  status: string;
  kind: object;
  proposer: string;
  votes: Record<string, string>;
}

type View = <T>(contractId: string, method: string, args?: object) => Promise<T>;

const WINDOW = 50;

export async function findProposalForDraft(
  view: View,
  daoId: string,
  draftId: string,
): Promise<DaoProposal | null> {
  const last = Number(await view<number>(daoId, "get_last_proposal_id"));
  if (last <= 0) return null;
  const from = Math.max(0, last - WINDOW);
  const list = await view<Array<DaoProposal & { description: string }>>(daoId, "get_proposals", {
    from_index: from,
    limit: WINDOW,
  });
  const tag = `Elivo payout batch ${draftId}:`;
  const hit = [...list].reverse().find((p) => p.description.includes(tag));
  if (!hit) return null;
  return { id: hit.id, status: hit.status, kind: hit.kind, proposer: hit.proposer, votes: hit.votes ?? {} };
}

/** Accounts in the policy's Group roles (the council). */
export function councilOf(policy: { roles?: Array<{ kind: unknown }> }): string[] {
  const out = new Set<string>();
  for (const r of policy.roles ?? []) {
    const k = r.kind as { Group?: string[] };
    if (k && typeof k === "object" && Array.isArray(k.Group)) for (const a of k.Group) out.add(a);
  }
  return [...out];
}
