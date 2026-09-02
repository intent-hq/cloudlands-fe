import type { InstalledEditor } from '$store/renderer/slices/external-editors/external-editors-slice';

export const FILE_MANAGER_EDITOR_ID = 'finder';

const FALLBACK_FINDER: InstalledEditor = {
  id: FILE_MANAGER_EDITOR_ID,
  name: 'Finder',
  shortLabel: 'Finder',
  appName: 'Finder',
  category: 'finder',
  handlerType: 'finder',
  installed: true,
  priority: 0,
};

export function getVisibleOpenInEditors(
  editors: InstalledEditor[],
  hiddenEditorIds: string[] = [],
): InstalledEditor[] {
  const hidden = new Set(hiddenEditorIds);
  const visible = editors.filter(({ installed, id }) => installed && !hidden.has(id));
  if (visible.some(({ id }) => id === FILE_MANAGER_EDITOR_ID) || hidden.has(FILE_MANAGER_EDITOR_ID)) {
    return visible;
  }
  return [...visible, FALLBACK_FINDER];
}
