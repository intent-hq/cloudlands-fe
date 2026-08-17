import { safeSlide } from '$lib/utils/animations';

/** Shared presentation contract for quiet, collapsible operational chat rows. */
export const OPERATIONAL_ROW_GEOMETRY_TOKENS_CLASS =
  '[--operational-row-inline-padding:0.5rem] [--operational-leading-slot-size:1.25rem] [--operational-leading-half-slot-size:0.625rem] [--operational-leading-gap:0.5rem]';

export const OPERATIONAL_ROW_TONE_CLASS =
  'type-body font-family-child font-normal text-muted-foreground';

export const OPERATIONAL_ROW_CONTAINER_CLASS = `tool-call-container group relative block w-full min-w-0 max-w-full overflow-hidden ${OPERATIONAL_ROW_TONE_CLASS}`;

export const OPERATIONAL_ROW_LINE_CLASS = `${OPERATIONAL_ROW_GEOMETRY_TOKENS_CLASS} relative flex min-h-9 w-full min-w-0 max-w-full items-center gap-[var(--operational-leading-gap)] overflow-hidden px-[var(--operational-row-inline-padding)] py-2`;

/** Top-level assistant prose starts where operational summary text starts. */
export const OPERATIONAL_ASSISTANT_PROSE_INSET_CLASS = `${OPERATIONAL_ROW_GEOMETRY_TOKENS_CLASS} min-w-0 max-w-full pl-[calc(var(--operational-row-inline-padding)+var(--operational-leading-slot-size)+var(--operational-leading-gap))]`;

export const OPERATIONAL_DISCLOSURE_CLASS =
  'flex min-w-0 max-w-full shrink items-center gap-[0.5ch] overflow-hidden border-0 bg-transparent p-0 text-left font-normal focus-visible:outline-none';

export const OPERATIONAL_SUMMARY_CLASS = 'min-w-0 shrink truncate whitespace-nowrap';

/** Expanded content shares the operational summary text origin. */
export const OPERATIONAL_EXPANDED_CONTENT_CLASS = `${OPERATIONAL_ROW_GEOMETRY_TOKENS_CLASS} min-w-0 max-w-full pl-[calc(var(--operational-row-inline-padding)+var(--operational-leading-slot-size)+var(--operational-leading-gap))] pt-1.5`;

/** Borderless tool details start 4px below the row at the summary text origin. */
export const OPERATIONAL_INLINE_DETAILS_CLASS = `${OPERATIONAL_ROW_GEOMETRY_TOKENS_CLASS} min-w-0 max-w-full pl-[calc(var(--operational-row-inline-padding)+var(--operational-leading-slot-size)+var(--operational-leading-gap))] pt-1`;

/** Group children stay on the top-level operational-row edge with no guide or horizontal offset. */
export const OPERATIONAL_GROUP_CONTENT_CLASS = 'min-w-0 max-w-full pt-1';

export const OPERATIONAL_PRIMARY_CLASS = 'text-muted-foreground';

export const OPERATIONAL_SECONDARY_CLASS = 'text-muted-foreground';

export const CHAT_OPERATIONAL_SUMMARY_TONE_CLASS = 'font-normal text-muted-foreground';

export const CHAT_OPERATIONAL_CONTAINER_CLASS =
  'tool-call-container group relative block w-full min-w-0 max-w-full overflow-hidden type-body font-family-child font-normal text-muted-foreground';

export const CHAT_OPERATIONAL_ICON_CLASS = 'h-[16px]! w-[16px]! shrink-0';

export const CHAT_OPERATIONAL_ROW_CLASS = `${OPERATIONAL_ROW_GEOMETRY_TOKENS_CLASS} relative grid h-9 w-full min-w-0 max-w-full grid-cols-[var(--operational-leading-slot-size)_minmax(0,1fr)_auto] items-center gap-[var(--operational-leading-gap)] overflow-hidden rounded-md px-[var(--operational-row-inline-padding)] type-body transition-colors duration-[var(--motion-fast)] motion-reduce:transition-none`;

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

export const OPERATIONAL_ICON_BOX_CLASS = `a11y-ignore pointer-events-none flex size-[var(--operational-leading-slot-size)] min-w-[var(--operational-leading-slot-size)] shrink-0 items-center justify-center ${OPERATIONAL_SECONDARY_CLASS}`;

export const OPERATIONAL_ICON_CLASS = CHAT_OPERATIONAL_ICON_CLASS;

interface OperationalClusterBlock {
  type: string;
}

export function isOperationalClusterBlock(block: OperationalClusterBlock): boolean {
  return block.type === 'thinking' || block.type === 'tool_use' || block.type === 'content_group';
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
): string {
  const block = blocks[index];
  if (!block || !isVisible(block)) return '';

  let previousIndex = index - 1;
  while (previousIndex >= 0 && !isVisible(blocks[previousIndex])) previousIndex -= 1;
  let nextIndex = index + 1;
  while (nextIndex < blocks.length && !isVisible(blocks[nextIndex])) nextIndex += 1;

  const previousIsOperational =
    previousIndex >= 0 && isOperationalClusterBlock(blocks[previousIndex]);
  if (!isOperationalClusterBlock(block)) {
    return previousIndex >= 0 && !previousIsOperational ? 'pt-2.5' : '';
  }

  const nextIsOperational =
    nextIndex < blocks.length && isOperationalClusterBlock(blocks[nextIndex]);
  const topSpacing =
    block.type === 'thinking' && previousIndex < 0
      ? ''
      : previousIsOperational
        ? block.type === 'thinking' && blocks[previousIndex]?.type === 'tool_use'
          ? 'pt-2'
          : ''
        : previousIndex < 0
          ? 'pt-4'
          : block.type === 'thinking' && blocks[previousIndex]?.type === 'notice'
            ? 'pt-2'
            : 'pt-[var(--chat-operational-text-gap,1rem)]';
  const bottomSpacing = nextIsOperational
    ? ''
    : nextIndex < blocks.length
      ? 'pb-[var(--chat-operational-text-gap,1rem)]'
      : 'pb-4';
  return [topSpacing, bottomSpacing].filter(Boolean).join(' ');
}

/** Tool-only collapsed row: fixed icon, one truncating sentence, optional trailing state/action. */
export const COMPACT_TOOL_ROW_CLASS = `${OPERATIONAL_ROW_GEOMETRY_TOKENS_CLASS} relative grid min-h-9 w-full min-w-0 max-w-full grid-cols-[var(--operational-leading-slot-size)_minmax(0,1fr)_auto] items-center gap-[var(--operational-leading-gap)] overflow-hidden px-[var(--operational-row-inline-padding)] py-2`;

export const COMPACT_TOOL_ICON_BOX_CLASS = `a11y-ignore flex size-[var(--operational-leading-slot-size)] min-w-[var(--operational-leading-slot-size)] items-center justify-center ${OPERATIONAL_SECONDARY_CLASS}`;

export const COMPACT_TOOL_SENTENCE_CLASS = `block min-w-0 max-w-full truncate whitespace-nowrap border-0 bg-transparent p-0 text-left font-normal ${OPERATIONAL_PRIMARY_CLASS} focus-visible:outline-none`;

export const COMPACT_TOOL_TRAILING_CLASS =
  'shrink-0 whitespace-nowrap text-ui text-subtle focus-visible:outline-none focus-visible:text-foreground';
