/**
 * Agent and Chief message attribution.
 *
 * The daemon tags user-role rows sent by another agent with `agent_message`,
 * and rows sent by the Chief with `chief_message` plus an exact source link.
 * Missing sender identity returns `null`. Incomplete Chief source metadata
 * keeps the label but omits navigation, so callers never render a broken link.
 */

import { conversationMessageUrl } from '$shared/constants/intent-links';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';

interface BaseMessageAttribution {
  /** Sender agent id — used to seed the avatar and open the agent tab. */
  fromAgentId: string;
}

export interface AgentSenderAttribution extends BaseMessageAttribution {
  kind: 'agent';
  /** Display name for the sender ("Agent" fallback, truncated to ~20 chars). */
  displayName: string;
}

export interface ChiefMessageAttribution extends BaseMessageAttribution {
  kind: 'chief';
  /** Exact source message link when the complete metadata contract is valid. */
  sourceUrl?: string;
}

export type AgentMessageAttribution = AgentSenderAttribution | ChiefMessageAttribution;

const MAX_NAME_LENGTH = 20;

/**
 * Extract sender attribution from an opaque message metadata object.
 * Returns `null` unless the type is supported and `fromAgentId` is non-empty.
 */
export function getAgentMessageAttribution(metadata: unknown): AgentMessageAttribution | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const md = metadata as Record<string, unknown>;
  const fromAgentId = typeof md.fromAgentId === 'string' ? md.fromAgentId.trim() : '';
  if (!fromAgentId) return null;

  if (md.type === 'chief_message') {
    const fromWorkspaceId = typeof md.fromWorkspaceId === 'string' ? md.fromWorkspaceId.trim() : '';
    const sourceMessageId = typeof md.sourceMessageId === 'string' ? md.sourceMessageId.trim() : '';
    const sourceUrl = typeof md.sourceUrl === 'string' ? md.sourceUrl.trim() : '';
    const expectedSourceUrl =
      fromWorkspaceId === CHIEF_WORKSPACE_ID && sourceMessageId
        ? conversationMessageUrl(fromWorkspaceId, fromAgentId, sourceMessageId)
        : '';

    return {
      kind: 'chief',
      fromAgentId,
      ...(sourceUrl && sourceUrl === expectedSourceUrl ? { sourceUrl } : {}),
    };
  }

  if (md.type !== 'agent_message') return null;

  const rawName = typeof md.fromAgentName === 'string' ? md.fromAgentName.trim() : '';
  const name = rawName || 'Agent';
  const displayName =
    name.length > MAX_NAME_LENGTH ? name.slice(0, MAX_NAME_LENGTH - 1) + '…' : name;

  return { kind: 'agent', fromAgentId, displayName };
}
