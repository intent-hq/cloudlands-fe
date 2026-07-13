export type TaskMenuPopoverData = {
  id: string;
  anchorName: string;
  taskData: {
    position: string | null;
    checked: boolean;
    text: string | null;
    node: unknown | null;
  };
};

function parseJsonAttribute(value: string | null): unknown | null {
  if (!value) return null;

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * Discover task menu popovers in a TipTap editor DOM.
 *
 * TipTap creates/destroys task buttons dynamically as content changes. The Popover API
 * requires matching `id`/`popovertarget` pairs in the DOM. This helper bridges the gap
 * by scanning for task menu buttons and extracting the data needed to render <TaskMenu />
 * instances in Svelte.
 */
export function discoverTaskMenuPopovers(root: Element): TaskMenuPopoverData[] {
  const taskButtons = root.querySelectorAll('[popovertarget^="task-menu-"]');
  const menuData: TaskMenuPopoverData[] = [];
  // Track seen IDs to prevent duplicates which cause Svelte {#each} key errors
  const seenIds = new Set<string>();

  taskButtons.forEach((button) => {
    const popoverId = button.getAttribute('popovertarget');
    const anchorName = button.getAttribute('data-anchor-name');

    if (!popoverId || !anchorName) return;

    // Skip duplicates - only keep the first occurrence of each ID
    if (seenIds.has(popoverId)) return;
    seenIds.add(popoverId);

    menuData.push({
      id: popoverId,
      anchorName,
      taskData: {
        position: button.getAttribute('data-task-position'),
        checked: button.getAttribute('data-task-checked') === 'true',
        text: button.getAttribute('data-task-text'),
        node: parseJsonAttribute(button.getAttribute('data-task-node')),
      },
    });
  });

  return menuData;
}
