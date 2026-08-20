/**
 * TaskAgentStatus preview mapping
 *
 * Maps the canonical `selectAgentPreview` result onto TaskAgentStatus's
 * `{ text | toolBlock, isStreaming }` rendering shape. TaskAgentStatus does
 * not render the `attention` or `report` kinds (the digest already has its
 * own template branch), so those map to null instead of inventing new UI.
 */

import type { ToolUseBlock } from '$shared/types';
import type { AgentPreview } from '$store/renderer/slices/agent-session/agent-session-selectors';

export interface TaskAgentLatestContent {
  text?: string;
  toolBlock?: ToolUseBlock;
  isStreaming: boolean;
}

/**
 * Pick the latest-content line to render, or null when there is nothing to
 * show. Live kinds animate; the persisted `last-tool` arm animates while the
 * agent is responding (tool-only live stretches), mirroring the previous
 * component-level derivation.
 */
export function mapAgentPreviewToLatestContent(
  preview: AgentPreview | null,
): TaskAgentLatestContent | null {
  if (!preview) return null;
  switch (preview.kind) {
    case 'attention':
    case 'report':
      return null;
    case 'live-text':
      return { text: preview.text, isStreaming: true };
    case 'live-tool':
      return { toolBlock: preview.toolUse, isStreaming: true };
    case 'user':
    case 'last-response':
    case 'last-user':
      return { text: preview.text, isStreaming: false };
    case 'last-tool':
      return { toolBlock: preview.toolUse, isStreaming: preview.isLive };
  }
}
