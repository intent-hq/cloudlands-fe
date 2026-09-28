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
  navigation: { messageId: string; path: string };
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

type GroupIdentity = {
  key: string;
  block: ContentBlockGroup;
  anchors: Set<string>;
  signature: string;
};

/** Retained by the panel, so group identity survives disposable renderer mounts. */
export function createWindowItemProjector() {
  let nextIdentity = 0;
  const previous = new Map<string, GroupIdentity[]>();
  const identities = new WeakMap<ContentBlockGroup, string>();
  return (
    blocks: readonly RenderContentBlock[],
    scope: string,
    visible: (block: RenderContentBlock, grouped?: boolean) => boolean,
    group?: ContentBlockGroup,
    groupIndex = 0,
    nested = true,
  ): WindowItem[] => {
    const keyFor = (block: ContentBlockGroup) => {
      let key = identities.get(block);
      if (!key) {
        key = `group-header:${nextIdentity++}`;
        identities.set(block, key);
      }
      return key;
    };
    if (!group) {
      const available = new Set(previous.get(scope) ?? []);
      const groups = blocks.filter(
        (block): block is ContentBlockGroup => block.type === 'content_group',
      );
      const records = groups.map((block) => ({
        block,
        anchors: new Set(
          block.children.flatMap((child) => (child.id ? [`${child.type}:${child.id}`] : [])),
        ),
        signature: JSON.stringify([block.sourceName ?? block.name, block.children]),
        match: undefined as GroupIdentity | undefined,
      }));
      const reserve = (
        matches: (record: (typeof records)[number], old: GroupIdentity) => boolean,
      ) => {
        for (const record of records) {
          if (record.match) continue;
          const match = [...available].find((old) => matches(record, old));
          if (match) {
            available.delete(match);
            record.match = match;
          }
        }
      };
      // Reserve every strong source match before a tag-first continuation can
      // claim a slot. A newly prepended same-name group must not steal a survivor.
      reserve((record, old) => old.block === record.block);
      reserve((record, old) => [...record.anchors].some((id) => old.anchors.has(id)));
      reserve((record, old) => old.signature === record.signature);
      for (const [ordinal, record] of records.entries()) {
        record.match ??= [...available].find((old) => {
          if (!old.block.isStreaming || old.anchors.size > 0) return false;
          const sameSlot = previous.get(scope)?.[ordinal] === old;
          const finalizingSlot = sameSlot && groups.length === previous.get(scope)?.length;
          if (!record.block.isStreaming && !finalizingSlot) return false;
          const oldName = old.block.sourceName ?? old.block.name;
          const name = record.block.sourceName ?? record.block.name;
          return oldName === name || (!oldName && sameSlot);
        });
        if (record.match) {
          available.delete(record.match);
          identities.set(record.block, record.match.key);
        }
      }
      previous.set(
        scope,
        records.map(({ block, anchors, signature }) => ({
          key: keyFor(block),
          block,
          anchors,
          signature,
        })),
      );
    }
    return projectWindowItems(blocks, scope, visible, group, groupIndex, nested, keyFor);
  };
}

/** No component construction or readable-heading DOM parsing occurs here. */
function projectWindowItems(
  blocks: readonly RenderContentBlock[],
  scope: string,
  visible: (block: RenderContentBlock, grouped?: boolean) => boolean,
  group: ContentBlockGroup | undefined,
  groupIndex = 0,
  nested: boolean,
  groupKey: (block: ContentBlockGroup) => string,
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
        ? groupKey(block)
        : getIdBackedContentBlockKey(block) ||
            getToolUseContentBlockKey(block) ||
            getToolResultContentBlockKey(block)
          ? getResponseGroupBlockKey(block, childIndex ?? index)
          : `${owner ? `group-child:${groupKey(owner)}:` : ''}${getResponseGroupBlockKey(block, childIndex ?? index)}`;
    const kind =
      block.type === 'tool_use'
        ? 'tool'
        : block.type === 'thinking'
          ? 'reasoning'
          : block.type === 'content_group'
            ? 'group'
            : 'content';
    const base = {
      navigation: {
        messageId: scope,
        path: childIndex === undefined ? `b:${index}` : `b:${index}:c:${childIndex}`,
      },
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
