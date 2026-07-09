import type { Proposal } from '$shared/types/proposal';
import { createProposalResource } from '$shared/types/proposal-resource';
import { Logger } from '$shared/logger';
import type { ContentItem } from './protocol';

const logger = new Logger('WsAppProposalContent');

export type ProposalEmitResult = { ok: true } | { ok: false; error: string };

/**
 * Legacy pre-emit hook. The FE-side MCP hub and its per-agent stream registry
 * were retired alongside the ACP providers; the daemon owns proposal delivery
 * to the chat now (streamed via `chat.subscribe`, PROTOCOL §7). Callers still
 * invoke this so their tool-result path is unchanged, but there is nothing for
 * the renderer to pre-emit — the daemon fan-out is the sole source of truth.
 */
export function emitProposalToChat(
  workspaceId: string,
  agentId: string | undefined,
  _proposal: Proposal,
): ProposalEmitResult {
  logger.debug('emitProposalToChat is a no-op after MCP hub retirement', {
    workspaceId,
    agentId,
  });
  return { ok: true };
}

export function proposalContentItems(proposal: Proposal): ContentItem[] {
  return [
    { type: 'text', text: JSON.stringify({ ok: true, proposal }, null, 2) },
    {
      type: 'resource',
      resource: createProposalResource(proposal),
    },
  ];
}

export function proposalToolResult(proposal: Proposal) {
  return {
    ok: true,
    proposal,
    __mcpContentItems: proposalContentItems(proposal),
  };
}