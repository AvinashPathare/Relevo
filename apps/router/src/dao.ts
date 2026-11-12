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

/**
 * `accept` must vet the proposal's kind: anyone can add a proposal with any description, so the text
 * alone proves nothing.
 */
export async function findProposalForDraft(
  view: View,
  daoId: string,
  draftId: string,
  accept: (kind: unknown) => boolean = () => true,
): Promise<DaoProposal | null> {
  const last = Number(await view<number>(daoId, "get_last_proposal_id"));
  if (last <= 0) return null;
  const from = Math.max(0, last - WINDOW);
  const list = await view<Array<DaoProposal & { description: string }>>(daoId, "get_proposals", {
    from_index: from,
    limit: WINDOW,
  });
  const tag = `Elivo payout batch ${draftId}:`;
  const hit = [...list].reverse().find((p) => p.description.startsWith(tag) && accept(p.kind));
  if (!hit) return null;
  return { id: hit.id, status: hit.status, kind: hit.kind, proposer: hit.proposer, votes: hit.votes ?? {} };
}

/** Sputnik permissions ("<kind label>:<action>") that let a role approve a FunctionCall proposal. */
const APPROVES_CALL = new Set(["*:*", "*:VoteApprove", "call:*", "call:VoteApprove"]);

/** Accounts in Group roles that may vote to approve a funding proposal (the council). */
export function councilOf(policy: { roles?: Array<{ kind: unknown; permissions?: string[] }> }): string[] {
  const out = new Set<string>();
  for (const r of policy.roles ?? []) {
    const k = r.kind as { Group?: string[] };
    if (!(k && typeof k === "object" && Array.isArray(k.Group))) continue;
    if (!(r.permissions ?? []).some((p) => APPROVES_CALL.has(p))) continue;
    for (const a of k.Group) out.add(a);
  }
  return [...out];
}
