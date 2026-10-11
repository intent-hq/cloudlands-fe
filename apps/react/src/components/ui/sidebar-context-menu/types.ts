// Source: src/lib/components/ui/sidebar-context-menu/types.ts.
import type { Icon as IconDefinition } from '@phosphor-icons/react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';

export interface SidebarMenuItem {
  id: string;
  label: string;
  icon?: IconDefinition;
  onClick: () => void;
  disabled?: boolean;
  disabledReason?: string;
  shortcut?: string;
  destructive?: boolean;
  /** Checked entries are semantic checkboxes unless inside a single-selection submenu. */
  checked?: boolean;
  /** Declare a submenu's children as one exclusive set of radio choices. */
  selection?: 'single';
  /** Commands close by default; checked choices remain open unless explicitly requested. */
  closeOnSelect?: boolean;
  /** Child items rendered in a flyout submenu; `onClick` is ignored when set. */
  submenu?: SidebarMenuItem[];
}

export interface SidebarMenuSeparator {
  type: 'separator';
}

interface SidebarMenuLabel {
  type: 'label';
  label: string;
  id?: string;
}

export type SidebarMenuEntry = SidebarMenuItem | SidebarMenuSeparator | SidebarMenuLabel;

export function isSeparator(entry: SidebarMenuEntry): entry is SidebarMenuSeparator {
  return 'type' in entry && entry.type === 'separator';
}

export interface SidebarContextPosition {
  x: number;
  y: number;
  returnFocus: HTMLElement | null;
}

/** Use from both oncontextmenu and onkeydown; unrelated keys are left untouched. */
export function getSidebarContextPosition(
  event:
    | MouseEvent
    | KeyboardEvent
    | ReactMouseEvent<HTMLElement>
    | ReactKeyboardEvent<HTMLElement>,
): SidebarContextPosition | null {
  const keyboard = 'key' in event;
  if (keyboard && event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10'))
    return null;
  event.preventDefault();
  event.stopPropagation();
  const returnFocus = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  const bounds = returnFocus?.getBoundingClientRect();
  return {
    x: keyboard ? (bounds?.left ?? 0) : event.clientX,
    y: keyboard ? (bounds?.bottom ?? 0) : event.clientY,
    returnFocus,
  };
}
