import { m } from '$shared/paraglide/messages.js';
import type {
  WorkspaceTabGroup,
  WorkspaceTabGroupColor,
} from '$store/renderer/slices/tab-state/tab-groups';

export function workspaceTabGroupColorLabel(color: WorkspaceTabGroupColor): string {
  switch (color) {
    case 'blue':
      return m.layout_workspaceTabGroup_color_blue_label();
    case 'green':
      return m.layout_workspaceTabGroup_color_green_label();
    case 'purple':
      return m.layout_workspaceTabGroup_color_purple_label();
    case 'orange':
      return m.layout_workspaceTabGroup_color_orange_label();
    case 'pink':
      return m.layout_workspaceTabGroup_color_pink_label();
    case 'grey':
      return m.layout_workspaceTabGroup_color_grey_label();
  }
}

/** The group name, or "<Color> group" for a group without a name. */
export function workspaceTabGroupDisplayName(group: WorkspaceTabGroup): string {
  return (
    group.name ||
    m.layout_workspaceTabGroup_unnamed_label({ color: workspaceTabGroupColorLabel(group.color) })
  );
}
