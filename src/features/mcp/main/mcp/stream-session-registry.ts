/**
 * Stream session registry — inert stub retained for the MCP proposal
 * pre-emit path in ws-app-proposal-content.emitProposalToChat.
 *
 * The former ACP-provider streaming registry was deleted with the
 * agent-providers/ spawn machinery in G2. The daemon-driven live path does
 * not populate this registry, so lookups return undefined and the emit path
 * short-circuits — matching the pre-deletion runtime behavior, since the
 * ACP registry was also empty in the live build once the FE-to-daemon seam
 * was cut (see G0 audit).
 *
 * G3 retires the whole MCP hub, at which point this file goes with it.
 */

import type { ContentBlock } from '$shared/types';

type StreamSession = {
  agentId?: string;
  workspaceId?: string;
  sessionId?: string;
  frontendSessionId?: string;
};

type StreamCallbacks = {
  onContentBlocks?: (blocks: ContentBlock[]) => void;
};

export const testStreamManager = {
  getSession(_id: string): StreamSession | undefined {
    return undefined;
  },
  callbacks: new Map<string, StreamCallbacks>(),
};
