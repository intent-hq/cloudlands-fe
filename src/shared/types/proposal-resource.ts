import { isProposal, type Proposal } from './proposal';

export const PROPOSAL_RESOURCE_MIME_TYPE = 'application/vnd.intent.proposal+json';

export interface ProposalResourceContents {
  uri: string;
  name: string;
  mimeType: typeof PROPOSAL_RESOURCE_MIME_TYPE;
  text: string;
}

function proposalResourceId(proposal: Proposal): string {
  return encodeURIComponent(proposal.applyToolCallId ?? proposal.preview.title);
}

export function createProposalResource(proposal: Proposal): ProposalResourceContents {
  return {
    uri: `intent-proposal://${proposal.kind}/${proposalResourceId(proposal)}`,
    name: proposal.preview.title,
    mimeType: PROPOSAL_RESOURCE_MIME_TYPE,
    text: JSON.stringify(proposal),
  };
}

export function getProposalFromResourceBlock(block: unknown): Proposal | null {
  if (!block || typeof block !== 'object') return null;
  const candidate = block as Record<string, any>;
  const resource = candidate.resource ?? candidate.metadata?.resource ?? candidate;

  if (
    !resource ||
    typeof resource !== 'object' ||
    resource.mimeType !== PROPOSAL_RESOURCE_MIME_TYPE ||
    typeof resource.text !== 'string'
  ) {
    return null;
  }

  try {
    const proposal = JSON.parse(resource.text);
    return isProposal(proposal) ? proposal : null;
  } catch {
    return null;
  }
}

/** Extract either a canonical proposal resource or a legacy inline proposal block. */
export function getProposalFromBlock(block: unknown): Proposal | null {
  if (!block || typeof block !== 'object') return null;
  const candidate = block as Record<string, any>;
  if (isProposal(candidate.proposal)) return candidate.proposal;

  const inlineCandidate = {
    kind: candidate.kind,
    payload: candidate.payload ?? {},
    preview: candidate.preview,
    applyToolCallId: candidate.applyToolCallId,
  };
  return isProposal(inlineCandidate) ? inlineCandidate : getProposalFromResourceBlock(candidate);
}
