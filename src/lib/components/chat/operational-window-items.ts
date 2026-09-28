import type { ContentBlockGroup, RenderContentBlock } from '$lib/utils/messageParser';
import {
  getContentBlockText,
  getIdBackedContentBlockKey,
  getToolUseContentBlockKey,
  getToolResultContentBlockKey,
} from '$shared/utils/content-block-helpers';
import {
  dedupeKeys,
  getResponseGroupBlockKey,
  shouldRenderResponseGroupInline,
} from './response-group-blocks';
import { extractReasoningHistory, projectStandaloneReasoningTitles } from './reasoning-heading';
import { operationalRowKey, type OperationalRowDescriptor } from './operational-row-window';

export interface WindowItem {
  key: string;
  kind: OperationalRowDescriptor['kind'];
  estimatedHeight: number;
  mountPath: string;
  block: RenderContentBlock;
  blockIndex: number;
  childIndex?: number;
  group?: ContentBlockGroup;
  nested: boolean;
  fragment: number;
  historyItem?: { title: string | null; body: string };
}

/** No component construction or readable-heading DOM parsing occurs here. */
export function projectWindowItems(
  blocks: readonly RenderContentBlock[],
  scope: string,
  visible: (block: RenderContentBlock, grouped?: boolean) => boolean,
  group?: ContentBlockGroup,
  groupIndex = 0,
  nested = true,
): WindowItem[] {
  const result: WindowItem[] = [];
  function append(
    block: RenderContentBlock,
    index: number,
    owner?: ContentBlockGroup,
    childIndex?: number,
    isNested = false,
  ) {
    if (!visible(block, !!owner)) return;
    if (block.type === 'content_group' && shouldRenderResponseGroupInline(block)) {
      block.children.forEach((child, ci) => append(child, index, block, ci));
      return;
    }
    const blockId =
      block.type === 'content_group'
        ? `group-header:${index}`
        : getIdBackedContentBlockKey(block) ||
            getToolUseContentBlockKey(block) ||
            getToolResultContentBlockKey(block)
          ? getResponseGroupBlockKey(block, childIndex ?? index)
          : `${owner ? `group-child:${index}:` : ''}${getResponseGroupBlockKey(block, childIndex ?? index)}`;
    const kind =
      block.type === 'tool_use'
        ? 'tool'
        : block.type === 'thinking'
          ? 'reasoning'
          : block.type === 'content_group'
            ? 'group'
            : 'content';
    const base = {
      // Freeze mutable operational fields until the attachment invalidation is
      // published. Tool-result blocks retain identity for result classification.
      block: block.type === 'thinking' || block.type === 'tool_use' ? { ...block } : block,
      blockIndex: index,
      childIndex,
      group: owner,
      nested: isNested,
      kind,
      mountPath: `${owner ? 'child' : 'top'}:${owner?.isReasoningPhase ? 'history' : kind}${block.type === 'tool_use' ? `:${block.name}` : ''}`,
    } as const;
    if (block.type === 'thinking') {
      const content = getContentBlockText(block);
      if (owner?.isReasoningPhase) {
        extractReasoningHistory(content).forEach((historyItem, fragment) =>
          result.push({
            ...base,
            kind: historyItem.title ? 'reasoning' : 'content',
            historyItem,
            fragment,
            key: operationalRowKey(scope, blockId, `history:${fragment}`),
            estimatedHeight: historyItem.title ? 28 : 48,
          }),
        );
        return;
      }
      const fragments = projectStandaloneReasoningTitles(content);
      if (fragments) {
        fragments.forEach((text, fragment) =>
          result.push({
            ...base,
            block: { ...block, text, content: undefined },
            fragment,
            key: operationalRowKey(
              scope,
              blockId,
              fragment === 0 ? 'summary' : `title:${fragment}`,
            ),
            mountPath: `${base.mountPath}:title`,
            estimatedHeight: 28,
          }),
        );
        return;
      }
    }
    result.push({
      ...base,
      fragment: 0,
      key: operationalRowKey(scope, blockId, 'summary'),
      estimatedHeight: kind === 'content' ? 48 : 28,
    });
  }
  blocks.forEach((block, i) =>
    append(block, group ? groupIndex : i, group, group ? i : undefined, !!group && nested),
  );
  const keys = dedupeKeys(result.map((item) => item.key));
  return result.map((item, index) => ({ ...item, key: keys[index] }));
}
