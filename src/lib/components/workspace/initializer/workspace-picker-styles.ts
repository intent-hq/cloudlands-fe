/** Shared presentation for the New Workspace settings menus. */
export const workspacePickerStyles = {
  fieldTrigger:
    '-ms-3 w-[calc(100%+0.75rem)] min-w-0 h-auto min-h-10 justify-start gap-2 px-3! py-2! text-sm leading-5 font-normal text-foreground',
  fieldLabel: 'w-24 shrink-0 whitespace-normal text-left text-muted-foreground',
  title: 'type-body font-medium text-foreground',
  rows: 'py-2 pe-2 ps-4',
  row: 'type-body h-auto min-h-10 items-center justify-start gap-2 rounded-(--radius-row) px-3 py-2 text-left font-normal text-foreground [--menu-icon-size:1rem] data-[selected]:bg-selected data-[state=checked]:bg-selected aria-selected:bg-selected aria-pressed:bg-selected',
  group: 'type-caption px-3 pt-2 pb-1 font-medium text-muted-foreground',
  icon: 'size-4 shrink-0 text-muted-foreground',
  check: 'size-4 shrink-0 text-primary-ink',
  /** Quiet metadata-row trigger surface (proposal card Project / Machine). */
  metadataTriggerSurface:
    // i18n-ignore (Tailwind class list)
    'rounded-md bg-muted/40! shadow-none! outline-none! hover:bg-muted/60! active:bg-muted/70! data-[state=open]:bg-muted/70! data-[state=open]:text-foreground focus-visible:bg-muted/70! focus-visible:text-foreground focus-visible:outline-none! focus-visible:outline-offset-0! focus-visible:ring-0! focus-visible:ring-offset-0! focus-visible:shadow-none! disabled:bg-muted/50! disabled:text-muted-foreground disabled:hover:bg-muted/50! forced-colors:border forced-colors:border-[ButtonText] forced-colors:bg-[ButtonFace] forced-colors:text-[ButtonText]',
  metadataTrigger:
    'group/metadata-trigger min-w-0 px-2! py-1! text-sm leading-5 font-normal text-foreground',
  metadataChevron: 'h-2.5 w-2.5 shrink-0 text-ghost opacity-70',
  /** Quiet dropdown trigger: no surface, chevron at the far right (proposal card Specialist / Start on). */
  bareTrigger:
    // i18n-ignore (Tailwind class list)
    'group inline-flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-sm font-normal leading-5 text-foreground transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer',
  bareValue: 'min-w-0 flex-1 truncate text-left text-foreground font-normal',
  bareChevron: 'h-2.5 w-2.5 shrink-0 text-ghost opacity-70',
  /** Metadata-row field label (proposal card Project / Machine). */
  metadataLabel: 'type-caption block font-medium text-muted-foreground',
} as const;
