/**
 * TaskAgentStatus preview mapping
 *
 * Maps the canonical `selectAgentPreview` result onto TaskAgentStatus's
 * `{ text | toolBlock, isStreaming }` rendering shape. TaskAgentStatus does
 * not render the `attention` kind, so it maps to null instead of inventing
 * new UI. The `report` kind renders as static text: the `agentDigest`
 * template branch shadows it whenever the report is the digest, so the only
 * case it actually renders is completionReport/summary text on idle agents —
 * information the pre-selector chain carried via the last-response line.
 */

import type { ToolUseBlock } from '$shared/types';
import type { AgentPreview } from '$store/renderer/slices/agent-session/agent-session-selectors';
import { classifyTool } from '$lib/utils/tool-classifier';

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
      return null;
    case 'live-text':
      return { text: preview.text, isStreaming: true };
    case 'live-tool':
      return { toolBlock: preview.toolUse, isStreaming: true };
    case 'user':
    case 'report':
    case 'last-response':
    case 'last-user':
      return { text: preview.text, isStreaming: false };
    case 'last-tool': {
      // Hidden tool labels (classifyTool) fall through to the status labels
      // instead of rendering a blank row — the selector's hidden gate only
      // covers the live overlay, and AgentPreviewToolLabel renders nothing
      // for hidden tools (e.g. raw mcp__ names, summary-less workspace_api).
      const input = (preview.toolUse.input as Record<string, unknown>) || {};
      if (classifyTool(preview.toolUse.name, input).hidden) return null;
      return { toolBlock: preview.toolUse, isStreaming: preview.isLive };
    }
  }
}
