import { safeSlide } from '$lib/utils/animations';

/** Shared presentation contract for quiet, collapsible operational chat rows. */
export const OPERATIONAL_ROW_GEOMETRY_TOKENS_CLASS =
  '[--operational-row-inline-padding:0.5rem] [--operational-leading-slot-size:1.25rem] [--operational-leading-half-slot-size:0.625rem] [--operational-leading-gap:0.5rem]';

export const OPERATIONAL_ROW_TONE_CLASS =
  'type-body font-family-child font-normal text-muted-foreground';

export const OPERATIONAL_ROW_LINE_CLASS = `${OPERATIONAL_ROW_GEOMETRY_TOKENS_CLASS} relative flex min-h-9 w-full min-w-0 max-w-full items-center gap-[var(--operational-leading-gap)] overflow-hidden px-[var(--operational-row-inline-padding)] py-2`;

/** Top-level assistant prose starts where operational summary text starts. */
export const OPERATIONAL_ASSISTANT_PROSE_INSET_CLASS = `${OPERATIONAL_ROW_GEOMETRY_TOKENS_CLASS} min-w-0 max-w-full pl-[calc(var(--operational-row-inline-padding)+var(--operational-leading-slot-size)+var(--operational-leading-gap))]`;

export const OPERATIONAL_SUMMARY_CLASS = 'min-w-0 shrink truncate whitespace-nowrap';

/** Expanded content shares the operational summary text origin. */
export const OPERATIONAL_EXPANDED_CONTENT_CLASS = `${OPERATIONAL_ROW_GEOMETRY_TOKENS_CLASS} min-w-0 max-w-full pl-[calc(var(--operational-row-inline-padding)+var(--operational-leading-slot-size)+var(--operational-leading-gap))] pt-1.5`;

/** Borderless tool details start 4px below the row at the summary text origin. */
export const OPERATIONAL_INLINE_DETAILS_CLASS = `${OPERATIONAL_ROW_GEOMETRY_TOKENS_CLASS} min-w-0 max-w-full pl-[calc(var(--operational-row-inline-padding)+var(--operational-leading-slot-size)+var(--operational-leading-gap))] pt-1`;

/** Group guide shares the header icon center; non-operational children share its text origin. */
export const OPERATIONAL_GROUP_CONTENT_CLASS = `${OPERATIONAL_ROW_GEOMETRY_TOKENS_CLASS} relative min-w-0 max-w-full`;

export const OPERATIONAL_GROUP_CHILD_CONTENT_CLASS = `${OPERATIONAL_ROW_GEOMETRY_TOKENS_CLASS} min-w-0 max-w-full pl-[calc(var(--operational-row-inline-padding)+var(--operational-leading-slot-size)+var(--operational-leading-gap))]`;

/** Nested operational rows shift right without overflowing the group. */
export const OPERATIONAL_GROUP_CHILD_ROW_CLASS = `${OPERATIONAL_ROW_GEOMETRY_TOKENS_CLASS} operational-group-child-row ml-2 min-w-0 w-[calc(100%-0.5rem)] max-w-[calc(100%-0.5rem)]`;

/** Match the existing 24px editorial seam before a new nested reasoning title. */
export const NESTED_REASONING_SECTION_SEAM_CLASS = 'pt-6';

export const OPERATIONAL_PRIMARY_CLASS = 'text-muted-foreground';

export const OPERATIONAL_SECONDARY_CLASS = 'text-muted-foreground';

export const CHAT_OPERATIONAL_SUMMARY_TONE_CLASS = 'font-normal text-muted-foreground';

export const CHAT_OPERATIONAL_CONTAINER_CLASS =
  'tool-call-container group relative block w-full min-w-0 max-w-full overflow-hidden type-body font-family-child font-normal text-muted-foreground';

export const CHAT_OPERATIONAL_ICON_CLASS = 'h-[16px]! w-[16px]! shrink-0';

export const CHAT_OPERATIONAL_ROW_CLASS = `${OPERATIONAL_ROW_GEOMETRY_TOKENS_CLASS} relative grid h-7 w-full min-w-0 max-w-full grid-cols-[var(--operational-leading-slot-size)_minmax(0,1fr)_auto] items-center gap-[var(--operational-leading-gap)] overflow-hidden rounded-md px-[var(--operational-row-inline-padding)] type-body transition-colors duration-[var(--motion-fast)] motion-reduce:transition-none`;

export const CHAT_OPERATIONAL_LEADING_CLASS = `a11y-ignore pointer-events-none flex size-[var(--operational-leading-slot-size)] min-w-[var(--operational-leading-slot-size)] shrink-0 items-center justify-center ${CHAT_OPERATIONAL_SUMMARY_TONE_CLASS}`;

export const CHAT_OPERATIONAL_SUMMARY_CLASS = `block min-w-0 max-w-full truncate overflow-hidden text-ellipsis whitespace-nowrap border-0 bg-transparent p-0 text-left ${CHAT_OPERATIONAL_SUMMARY_TONE_CLASS}`;

export const CHAT_OPERATIONAL_TRAILING_CLASS =
  'flex min-w-0 shrink-0 items-center gap-1 whitespace-nowrap';

export const CHAT_OPERATIONAL_CHEVRON_CLASS =
  'h-[16px]! w-[16px]! shrink-0 opacity-60 transition-transform duration-[var(--motion-fast)] motion-reduce:transition-none';

export function safeOperationalDetailsTransition(node: Element) {
  const reduced =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  return safeSlide(node, { axis: 'y', duration: reduced ? 0 : 150 });
}

interface OperationalClusterBlock {
  type: string;
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
    return compactConsecutiveThinking ? '' : 'pt-14';
  }
  const previousIsOperational = isOperationalClusterBlock(previous);
  const currentIsOperational = isOperationalClusterBlock(block);
  if (previousIsOperational && currentIsOperational) return '';
  if (previous.type === 'thinking' && !currentIsOperational) return 'pt-6';
  if (previousIsOperational || currentIsOperational) return 'pt-4';
  return 'pt-1';
}

export const COMPACT_TOOL_TRAILING_CLASS =
  'shrink-0 whitespace-nowrap text-ui text-subtle focus-visible:outline-none focus-visible:text-foreground';
