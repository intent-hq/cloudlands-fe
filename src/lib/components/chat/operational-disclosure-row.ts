import { safeSlide } from '$lib/utils/animations';
import { prefersReducedMotion } from '$lib/utils/reduced-motion';
import { projectStandaloneReasoningTitles } from './reasoning-heading';

export {
  OPERATIONAL_ROW_GEOMETRY_TOKENS_CLASS,
  OPERATIONAL_ROW_TONE_CLASS,
  OPERATIONAL_ASSISTANT_PROSE_INSET_CLASS,
  OPERATIONAL_EXPANDED_CONTENT_CLASS,
  OPERATIONAL_INLINE_DETAILS_CLASS,
  OPERATIONAL_GROUP_CONTENT_CLASS,
  OPERATIONAL_GROUP_CHILD_CONTENT_CLASS,
  OPERATIONAL_GROUP_CHILD_ROW_CLASS,
  NESTED_REASONING_SECTION_SEAM_CLASS,
  OPERATIONAL_PRIMARY_CLASS,
  OPERATIONAL_SECONDARY_CLASS,
  CHAT_OPERATIONAL_SUMMARY_TONE_CLASS,
  CHAT_OPERATIONAL_CONTAINER_CLASS,
  CHAT_OPERATIONAL_ICON_CLASS,
  CHAT_OPERATIONAL_ROW_CLASS,
  CHAT_OPERATIONAL_LEADING_CLASS,
  CHAT_OPERATIONAL_SUMMARY_CLASS,
  CHAT_OPERATIONAL_TRAILING_CLASS,
  CHAT_OPERATIONAL_CHEVRON_CLASS,
  COMPACT_TOOL_TRAILING_CLASS,
} from './operational-disclosure-classes';

export function safeOperationalDetailsTransition(node: Element) {
  return safeSlide(node, { axis: 'y', duration: prefersReducedMotion() ? 0 : 150 });
}

interface OperationalClusterBlock {
  type: string;
  text?: string;
  content?: string;
}

export function isOperationalClusterBlock(block: OperationalClusterBlock): boolean {
  return block.type === 'thinking' || block.type === 'tool_use' || block.type === 'content_group';
}

export function getOperationalGroupContentSpacingClass<T extends OperationalClusterBlock>(
  blocks?: readonly T[],
): string {
  const firstVisibleBlock = blocks?.[0];
  if (!firstVisibleBlock || isOperationalClusterBlock(firstVisibleBlock)) return '';
  return 'pt-4';
}

export function isAdjacentOperationalClusterRow<T extends OperationalClusterBlock>(
  blocks: readonly T[],
  index: number,
  isVisible: (block: T) => boolean = () => true,
): boolean {
  const block = blocks[index];
  if (!block || !isVisible(block) || !isOperationalClusterBlock(block)) return false;

  let previousIndex = index - 1;
  while (previousIndex >= 0 && !isVisible(blocks[previousIndex])) previousIndex -= 1;
  return previousIndex >= 0 && isOperationalClusterBlock(blocks[previousIndex]);
}

export function getOperationalClusterSpacingClass<T extends OperationalClusterBlock>(
  blocks: readonly T[],
  index: number,
  isVisible: (block: T) => boolean = () => true,
  compactConsecutiveThinking = false,
): string {
  const block = blocks[index];
  if (!block || !isVisible(block)) return '';

  let previousIndex = index - 1;
  while (previousIndex >= 0 && !isVisible(blocks[previousIndex])) previousIndex -= 1;
  if (previousIndex < 0) return '';

  const previous = blocks[previousIndex];
  if (previous.type === 'thinking' && block.type === 'thinking') {
    if (compactConsecutiveThinking) return '';
    const titlesOnly =
      projectStandaloneReasoningTitles(previous.text ?? previous.content ?? '') !== null &&
      projectStandaloneReasoningTitles(block.text ?? block.content ?? '') !== null;
    return titlesOnly ? '' : 'pt-14';
  }
  const previousIsOperational = isOperationalClusterBlock(previous);
  const currentIsOperational = isOperationalClusterBlock(block);
  if (previousIsOperational && currentIsOperational) return '';
  if (previous.type === 'thinking' && !currentIsOperational) return 'pt-6';
  if (previousIsOperational || currentIsOperational) return 'pt-4';
  return 'pt-1';
}
