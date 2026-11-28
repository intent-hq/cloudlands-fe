/**
 * The path on this computer of a dropped file or folder: Electron's preload
 * exposes it as `getPathForFile`. '' in a browser build or when Electron does
 * not know one (the library then ignores the drop).
 */
export function droppedPath(file: File, win: Window | undefined = globalThis.window): string {
  try {
    return win?.electronAPI?.getPathForFile?.(file) ?? '';
  } catch {
    return '';
  }
}
