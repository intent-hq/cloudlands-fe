import type { InstalledEditor } from '$store/renderer/slices/external-editors/external-editors-slice';

export const MAX_OPEN_IN_APPS = 3;
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

export function getVisibleOpenInEditors(editors: InstalledEditor[]): InstalledEditor[] {
  const fileManager = editors.find(({ id }) => id === FILE_MANAGER_EDITOR_ID) ?? FALLBACK_FINDER;
  const apps = editors.filter(({ id }) => id !== FILE_MANAGER_EDITOR_ID).slice(0, MAX_OPEN_IN_APPS);
  return [...apps, fileManager];
}
