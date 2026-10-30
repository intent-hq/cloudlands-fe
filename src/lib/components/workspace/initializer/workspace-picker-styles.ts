/** Shared presentation for the New Workspace settings menus. */
export const workspacePickerStyles = {
  fieldLabel: 'w-24 shrink-0 whitespace-normal text-left text-muted-foreground',
  header: 'shrink-0 px-4 pt-3 pb-2',
  title: 'type-body font-medium text-foreground',
  description: 'type-caption mt-1 text-muted-foreground',
  rows: 'p-2',
  row: 'type-body h-auto min-h-10 items-center justify-start gap-2 rounded-(--radius-row) px-3 py-2 text-left font-normal text-foreground [--menu-icon-size:1rem] data-[selected]:bg-selected data-[state=checked]:bg-selected aria-selected:bg-selected aria-pressed:bg-selected',
  group: 'type-caption px-3 pt-2 pb-1 font-medium text-muted-foreground',
  search: 'type-body h-9',
  icon: 'size-4 shrink-0 text-muted-foreground',
  check: 'size-4 shrink-0 text-primary-ink',
} as const;
