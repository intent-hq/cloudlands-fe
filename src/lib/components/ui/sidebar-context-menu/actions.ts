import type { ActionDefinition, RadioAction } from '$lib/components/patterns/action-menu';
import {
  isSeparator,
  type SidebarMenuEntry,
  type SidebarMenuItem,
} from '$lib/components/ui/sidebar-context-menu/types';

/** Both invocation paths use this adapter; callbacks stay with the caller. */
export function toSidebarActions(
  entries: readonly SidebarMenuEntry[],
  selection?: 'single',
  label = '',
): ActionDefinition[] {
  let group = 0;
  const actions: ActionDefinition[] = [];
  for (const [index, entry] of entries.entries()) {
    if (isSeparator(entry)) {
      group += 1;
      continue;
    }
    if ('type' in entry && entry.type === 'label') {
      actions.push({
        kind: 'label',
        id: entry.id ?? `sidebar-label-${index}`,
        label: entry.label,
        group: String(group),
      });
      continue;
    }
    const base = {
      id: entry.id,
      label: entry.label,
      icon: entry.icon,
      disabled: entry.disabled,
      disabledReason: entry.disabledReason,
      shortcut: entry.shortcut,
      closeOnSelect: entry.closeOnSelect,
      group: String(group),
    };
    if (entry.submenu) {
      // Explicit radio groups avoid guessing whether independent checked items are exclusive.
      if (entry.selection === 'single') {
        const children: RadioAction[] = entry.submenu.map((child) => ({
          kind: 'radio',
          id: child.id,
          value: child.id,
          label: child.label,
          icon: child.icon,
          disabled: child.disabled,
          disabledReason: child.disabledReason,
          shortcut: child.shortcut,
          closeOnSelect: child.closeOnSelect,
        }));
        actions.push({
          ...base,
          kind: 'submenu',
          children: [
            {
              kind: 'radio-group',
              id: `${entry.id}-selection`,
              label: entry.label,
              value: entry.submenu.find((child) => child.checked)?.id ?? '',
              children,
            },
          ],
        });
      } else {
        actions.push({ ...base, kind: 'submenu', children: toSidebarActions(entry.submenu) });
      }
    } else if (entry.checked !== undefined) {
      actions.push({ ...base, kind: 'checkbox', checked: entry.checked });
    } else {
      actions.push({ ...base, kind: 'action', destructive: entry.destructive });
    }
  }
  if (selection !== 'single') return actions;
  const grouped: ActionDefinition[] = [];
  for (const action of actions) {
    if (action.kind !== 'checkbox') {
      grouped.push(action);
      continue;
    }
    const previous = grouped.at(-1);
    const child: RadioAction = { ...action, kind: 'radio', checked: undefined, value: action.id };
    if (previous?.kind === 'radio-group' && previous.group === action.group) {
      previous.children = [...previous.children, child];
      if (action.checked) previous.value = action.id;
    } else {
      grouped.push({
        kind: 'radio-group',
        id: `${action.id}-selection`,
        label,
        group: action.group,
        value: action.checked ? action.id : '',
        children: [child],
      });
    }
  }
  return grouped;
}

export function findSidebarItem(
  entries: readonly SidebarMenuEntry[],
  id: string,
): SidebarMenuItem | undefined {
  for (const entry of entries) {
    if ('type' in entry) continue;
    if (entry.id === id) return entry;
    const child = entry.submenu ? findSidebarItem(entry.submenu, id) : undefined;
    if (child) return child;
  }
}
