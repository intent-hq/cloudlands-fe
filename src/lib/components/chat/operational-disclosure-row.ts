/** Shared presentation contract for quiet, collapsible operational chat rows. */
export const OPERATIONAL_ROW_GEOMETRY_TOKENS_CLASS =
  '[--operational-row-inline-padding:0.75rem] [--operational-leading-slot-size:1.25rem] [--operational-leading-gap:0.5rem]';

export const OPERATIONAL_ROW_TONE_CLASS =
  'type-body font-family-child font-normal text-muted-foreground transition-colors duration-[var(--motion-fast)] hover:text-foreground focus-visible:text-foreground focus-within:text-foreground';

export const OPERATIONAL_ROW_CONTAINER_CLASS = `tool-call-container group relative block w-full min-w-0 max-w-full overflow-hidden ${OPERATIONAL_ROW_TONE_CLASS}`;

export const OPERATIONAL_ROW_LINE_CLASS = `${OPERATIONAL_ROW_GEOMETRY_TOKENS_CLASS} relative flex min-h-9 w-full min-w-0 max-w-full items-center gap-[var(--operational-leading-gap)] overflow-hidden px-[var(--operational-row-inline-padding)] py-2`;

/** Top-level assistant prose starts where operational summary text starts. */
export const OPERATIONAL_ASSISTANT_PROSE_INSET_CLASS = `${OPERATIONAL_ROW_GEOMETRY_TOKENS_CLASS} min-w-0 max-w-full pl-[calc(var(--operational-row-inline-padding)+var(--operational-leading-slot-size)+var(--operational-leading-gap))]`;

export const OPERATIONAL_DISCLOSURE_CLASS =
  'flex min-w-0 max-w-full shrink items-center gap-[0.5ch] overflow-hidden border-0 bg-transparent p-0 text-left font-normal focus-visible:outline-none focus-visible:text-foreground';

export const OPERATIONAL_SUMMARY_CLASS = 'min-w-0 shrink truncate whitespace-nowrap';

export const OPERATIONAL_EXPANDED_CONTENT_CLASS = 'pt-1.5';

export const OPERATIONAL_PRIMARY_CLASS = 'text-muted-foreground';

export const OPERATIONAL_SECONDARY_CLASS =
  'text-ghost transition-colors group-hover:text-muted-foreground group-focus-within:text-muted-foreground';

export const OPERATIONAL_ICON_BOX_CLASS = `a11y-ignore pointer-events-none flex size-[var(--operational-leading-slot-size)] min-w-[var(--operational-leading-slot-size)] shrink-0 items-center justify-center ${OPERATIONAL_SECONDARY_CLASS}`;

export const OPERATIONAL_ICON_CLASS = 'h-[1.125rem]! w-[1.125rem]! shrink-0';

/** Tool-only collapsed row: fixed icon, one truncating sentence, optional trailing state/action. */
export const COMPACT_TOOL_ROW_CLASS = `${OPERATIONAL_ROW_GEOMETRY_TOKENS_CLASS} relative grid min-h-9 w-full min-w-0 max-w-full grid-cols-[var(--operational-leading-slot-size)_minmax(0,1fr)_auto] items-center gap-[var(--operational-leading-gap)] overflow-hidden px-[var(--operational-row-inline-padding)] py-2`;

export const COMPACT_TOOL_ICON_BOX_CLASS = `a11y-ignore flex size-[var(--operational-leading-slot-size)] min-w-[var(--operational-leading-slot-size)] items-center justify-center ${OPERATIONAL_SECONDARY_CLASS}`;

export const COMPACT_TOOL_SENTENCE_CLASS =
  'block min-w-0 max-w-full truncate whitespace-nowrap border-0 bg-transparent p-0 text-left font-normal text-muted-foreground focus-visible:outline-none focus-visible:text-foreground';

export const COMPACT_TOOL_TRAILING_CLASS =
  'shrink-0 whitespace-nowrap text-ui text-subtle focus-visible:outline-none focus-visible:text-foreground';
