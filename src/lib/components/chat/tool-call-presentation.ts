import type { ContentBlock } from '$shared/types';
import type { ToolDisplay } from '$lib/utils/tool-classifier';
import type { CompactToolDisplayModel, ToolState } from './tool-display-model';
import { getToolResultText } from './tool-result-pairing';

/** Streaming skeletons and their replacements share the addressable block ID. */
export function dedupeToolUseBlocks(blocks: ContentBlock[]): ContentBlock[] {
  const last = new Map<string, number>();
  blocks.forEach((block, index) => {
    if (block.type === 'tool_use' && block.id) last.set(block.id, index);
  });
  if (last.size === 0) return blocks;
  return blocks.filter(
    (block, index) => block.type !== 'tool_use' || !block.id || last.get(block.id) === index,
  );
}

/** The transcript result owns status; provider metadata alone does not. */
export function getToolCallState(result: ContentBlock | undefined, isStreaming = false): ToolState {
  if (!result) return isStreaming ? 'running' : 'completed';
  const text = getToolResultText(result);
  // i18n-ignore (wire-content sniffing, not rendered)
  const errorText = text.startsWith('Error:') || text.includes('Tool Error:');
  return result.is_error || result.isError || errorText ? 'error' : 'completed';
}

/** Shared with the source ToolCall: no unlabelled or empty successful rows. */
export function shouldRenderToolCall(
  display: ToolDisplay,
  model: CompactToolDisplayModel,
  input: Record<string, unknown>,
  result: unknown,
  state: ToolState,
): boolean {
  if (display.hidden) return false;
  if (state === 'error' || state === 'running' || model.isOkOnlyWorkspaceResult) return true;
  const empty =
    result == null ||
    (typeof result === 'string' && result.trim() === '') ||
    (Array.isArray(result) && result.length === 0) ||
    (typeof result === 'object' && Object.keys(result).length === 0);
  return !(empty && !Object.keys(input).some((key) => !key.startsWith('_')) && !model.sentence);
}
