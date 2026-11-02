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
} as const;
