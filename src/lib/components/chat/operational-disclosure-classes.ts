/** Shared presentation contract for quiet, collapsible operational chat rows. */
export const OPERATIONAL_ROW_GEOMETRY_TOKENS_CLASS =
  '[--operational-row-inline-padding:var(--chat-operational-row-inline-padding,0.5rem)] [--operational-leading-slot-size:1.25rem] [--operational-leading-half-slot-size:0.625rem] [--operational-leading-gap:var(--chat-operational-leading-gap,0.5rem)]';

export const OPERATIONAL_ROW_TONE_CLASS =
  'type-body font-family-child font-normal text-muted-foreground';

/** Top-level assistant prose starts where operational summary text starts. */
export const OPERATIONAL_ASSISTANT_PROSE_INSET_CLASS = `${OPERATIONAL_ROW_GEOMETRY_TOKENS_CLASS} min-w-0 max-w-full pl-[calc(var(--operational-row-inline-padding)+var(--operational-leading-slot-size)+var(--operational-leading-gap))]`;

/** Expanded content shares the operational summary text origin. */
export const OPERATIONAL_EXPANDED_CONTENT_CLASS = `${OPERATIONAL_ROW_GEOMETRY_TOKENS_CLASS} min-w-0 max-w-full pl-[calc(var(--operational-row-inline-padding)+var(--operational-leading-slot-size)+var(--operational-leading-gap))] pt-1.5`;

/** Borderless tool details start 4px below the row at the summary text origin. */
export const OPERATIONAL_INLINE_DETAILS_CLASS = `${OPERATIONAL_ROW_GEOMETRY_TOKENS_CLASS} min-w-0 max-w-full pl-[calc(var(--operational-row-inline-padding)+var(--operational-leading-slot-size)+var(--operational-leading-gap))] pt-1`;

/** Group guide shares the header icon center; non-operational children share its text origin. */
export const OPERATIONAL_GROUP_CONTENT_CLASS = `${OPERATIONAL_ROW_GEOMETRY_TOKENS_CLASS} relative min-w-0 max-w-full`;

export const OPERATIONAL_GROUP_CHILD_CONTENT_CLASS = `${OPERATIONAL_ROW_GEOMETRY_TOKENS_CLASS} min-w-0 max-w-full pl-[calc(var(--operational-row-inline-padding)+var(--operational-leading-slot-size)+var(--operational-leading-gap))]`;

/** Nested operational rows shift right without overflowing the group. */
export const OPERATIONAL_GROUP_CHILD_ROW_CLASS = `${OPERATIONAL_ROW_GEOMETRY_TOKENS_CLASS} operational-group-child-row ml-2 min-w-0 w-[calc(100%-0.5rem)] max-w-[calc(100%-0.5rem)]`;

/** Preserve 24px before a nested reasoning title that follows body content. */
export const NESTED_REASONING_SECTION_SEAM_CLASS = 'pt-6';

export const OPERATIONAL_PRIMARY_CLASS = 'text-muted-foreground';

export const OPERATIONAL_SECONDARY_CLASS = 'text-muted-foreground';

export const CHAT_OPERATIONAL_SUMMARY_TONE_CLASS = 'font-normal text-muted-foreground';

export const CHAT_OPERATIONAL_CONTAINER_CLASS =
  'tool-call-container group relative block w-full min-w-0 max-w-full overflow-hidden type-body font-family-child font-normal text-muted-foreground';

export const CHAT_OPERATIONAL_ICON_CLASS = 'h-[16px]! w-[16px]! shrink-0';

export const CHAT_OPERATIONAL_ROW_CLASS = `${OPERATIONAL_ROW_GEOMETRY_TOKENS_CLASS} relative grid h-7 w-full min-w-0 max-w-full grid-cols-[var(--operational-leading-slot-size)_minmax(0,1fr)_auto] items-center gap-[var(--operational-leading-gap)] overflow-hidden rounded-md px-[var(--operational-row-inline-padding)] type-body transition-colors duration-[var(--motion-fast)] motion-reduce:transition-none`;

export const CHAT_OPERATIONAL_LEADING_CLASS = `a11y-ignore pointer-events-none flex size-[var(--operational-leading-slot-size)] min-w-[var(--operational-leading-slot-size)] shrink-0 items-center justify-center [&_svg]:size-[16px]! ${CHAT_OPERATIONAL_SUMMARY_TONE_CLASS}`;

export const CHAT_OPERATIONAL_SUMMARY_CLASS = `type-body block min-w-0 max-w-full truncate overflow-hidden text-ellipsis whitespace-nowrap border-0 bg-transparent p-0 text-left ${CHAT_OPERATIONAL_SUMMARY_TONE_CLASS}`;

export const CHAT_OPERATIONAL_TRAILING_CLASS =
  'type-body flex min-w-0 shrink-0 items-center gap-1 whitespace-nowrap';

export const CHAT_OPERATIONAL_CHEVRON_CLASS =
  'h-[16px]! w-[16px]! shrink-0 opacity-60 transition-transform duration-[var(--motion-fast)] motion-reduce:transition-none';

export const COMPACT_TOOL_TRAILING_CLASS =
  'shrink-0 whitespace-nowrap text-ui text-subtle focus-visible:outline-none focus-visible:text-foreground';
