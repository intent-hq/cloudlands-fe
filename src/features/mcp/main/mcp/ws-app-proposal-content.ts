import type { Proposal } from '$shared/types/proposal';
import { createProposalResource } from '$shared/types/proposal-resource';
import type { ContentBlock } from '$shared/types';
import { Logger } from '$shared/logger';
import { testStreamManager as streamSessionManager } from './stream-session-registry';
import * as messageAccumulator from '../../../../store/main/slices/message-accumulator/message-accumulator-api';
import type { ContentItem } from './protocol';

const logger = new Logger('WsAppProposalContent');

type StreamSession = {
  agentId?: string;
  workspaceId?: string;
  sessionId?: string;
  frontendSessionId?: string;
};

type StreamCallbacks = {
  onContentBlocks?: (blocks: ContentBlock[]) => void;
};

type StreamSessionManager = {
  getSession(id: string): StreamSession | undefined;
  callbacks?: Map<string, StreamCallbacks>;
};

function createProposalBlock(proposal: Proposal): ContentBlock {
  const applyToolCallId = proposal.applyToolCallId;

  return {
    type: 'proposal',
    kind: proposal.kind,
    payload: proposal.payload,
    preview: proposal.preview,
    applyToolCallId,
    proposal,
  };
}

export type ProposalEmitResult = { ok: true } | { ok: false; error: string };

export function emitProposalToChat(
  workspaceId: string,
  agentId: string | undefined,
  proposal: Proposal,
): ProposalEmitResult {
  const manager = streamSessionManager as unknown as StreamSessionManager;
  const session = agentId ? manager.getSession(agentId) : undefined;

  if (!agentId || !session || session.workspaceId !== workspaceId) {
    logger.debug('No active stream session for proposal pre-emit', {
      workspaceId,
      agentId,
      hasSession: !!session,
      sessionWorkspaceId: session?.workspaceId,
    });
    return { ok: true };
  }

  const block = createProposalBlock(proposal);
  const errors: string[] = [];

  try {
    if (!messageAccumulator.getAccumulated(agentId)) {
      messageAccumulator.startAccumulation(agentId, {
        sessionId: session.sessionId,
        agentId: session.agentId ?? agentId,
        frontendSessionId: session.frontendSessionId,
      });
    }
    messageAccumulator.addContentBlock(agentId, block);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to pre-emit proposal block to accumulator', {
      workspaceId,
      agentId,
      error: message,
    });
    errors.push(`accumulator: ${message}`);
  }

  const callbacks = manager.callbacks?.get(session.agentId ?? agentId);
  if (callbacks?.onContentBlocks) {
    try {
      callbacks.onContentBlocks([block]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Failed to pre-emit proposal block to stream callback', {
        workspaceId,
        agentId,
        error: message,
      });
      errors.push(`stream callback: ${message}`);
    }
  }

  if (errors.length > 0) {
    return { ok: false, error: errors.join('; ') };
  }
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