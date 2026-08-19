/**
 * AgentCard preview derivation
 *
 * Collapses the card's preview precedence chain (attention request → live
 * streamed text → renderable in-flight tool → newest user line →
 * digest/report → persisted transcript fallbacks) into a single value so the
 * template renders one persistent container instead of sibling `{:else if}`
 * blocks that unmount/mount (and height-animate) on every source flip.
 * Precedence semantics are byte-identical to the previous template chain.
 */

import type { ToolUseBlock } from '$shared/types';
import type { AgentAttentionRequest } from '$shared/utils/agent-attention';

export interface AgentCardPreviewInputs {
  /** Pending attention request (discussion/blocker), or null. */
  attentionRequest: AgentAttentionRequest | null;
  /** Live text line (push-applied wire lastAgentResponse while responding). */
  liveResponseLine: string;
  /** In-flight tool_use overlay while streaming. */
  liveToolUse: ToolUseBlock | undefined;
  /** liveToolUse exists and classifies as renderable (not hidden). */
  hasRenderableLiveTool: boolean;
  /** Freshness-wins: newest transcript message is the user's. */
  showUserMessagePreview: boolean;
  /** First line of the newest user message. */
  userFirstLine: string;
  /** Digest / completion report / response summary (idle-agent fallback). */
  effectiveCompletionReport: string | undefined;
  /** Persisted transcript response text (peek-derived). */
  lastResponse: string;
  /** Persisted transcript tool_use preview. */
  lastToolUse: ToolUseBlock | undefined;
  /** Persisted last user message text. */
  lastUserMsg: string;
}

export type AgentCardPreview =
  | { kind: 'attention'; attention: AgentAttentionRequest }
  | { kind: 'live-text'; text: string }
  | { kind: 'live-tool'; toolUse: ToolUseBlock }
  | { kind: 'user'; text: string }
  | { kind: 'report'; text: string }
  | { kind: 'last-response'; text: string }
  | { kind: 'last-tool'; toolUse: ToolUseBlock }
  | { kind: 'last-user'; text: string };

/**
 * Pick the single preview to render, or null when the card has no preview
 * line. Hidden tool labels fall through (hasRenderableLiveTool is false).
 */
export function deriveAgentCardPreview(inputs: AgentCardPreviewInputs): AgentCardPreview | null {
  if (inputs.attentionRequest) {
    return { kind: 'attention', attention: inputs.attentionRequest };
  }
  if (inputs.liveResponseLine) {
    return { kind: 'live-text', text: inputs.liveResponseLine };
  }
  if (inputs.hasRenderableLiveTool && inputs.liveToolUse) {
    return { kind: 'live-tool', toolUse: inputs.liveToolUse };
  }
  if (inputs.showUserMessagePreview) {
    return { kind: 'user', text: inputs.userFirstLine };
  }
  if (inputs.effectiveCompletionReport) {
    return { kind: 'report', text: inputs.effectiveCompletionReport };
  }
  if (inputs.lastUserMsg || inputs.lastResponse || inputs.lastToolUse) {
    if (inputs.lastResponse) {
      return { kind: 'last-response', text: inputs.lastResponse };
    }
    if (inputs.lastToolUse) {
      return { kind: 'last-tool', toolUse: inputs.lastToolUse };
    }
    if (inputs.lastUserMsg) {
      return { kind: 'last-user', text: inputs.lastUserMsg };
    }
  }
  return null;
}
