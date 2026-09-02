/**
 * Split a drop's payload into regular files and folders.
 *
 * Folder detection is only possible synchronously inside the drop event:
 * `DataTransferItem.webkitGetAsEntry()` returns null once the event loop
 * turns, so callers must invoke this AT drop time and carry the result —
 * downstream code never gets another chance to inspect the entries.
 *
 * Folders are returned as their `File` objects (a dropped directory still
 * yields a File entry in `dataTransfer`); callers resolve the absolute host
 * path via `electronAPI.getPathForFile(file)` which works for directories
 * too. When `webkitGetAsEntry` is unavailable (older engines, synthetic
 * test events) every item degrades to a plain file — prior behavior.
 */
export interface DropSplit {
  /** Regular files, in drop order. */
  files: File[];
  /** Files that are actually directories, in drop order. */
  folderFiles: File[];
}

export function splitDroppedItems(dataTransfer: DataTransfer | null): DropSplit {
  const files: File[] = [];
  const folderFiles: File[] = [];
  if (!dataTransfer) return { files, folderFiles };

  const items = dataTransfer.items;
  if (items && items.length > 0) {
    let sawFileItem = false;
    for (const item of Array.from(items)) {
      if (item.kind !== 'file') continue;
      sawFileItem = true;
      const file = item.getAsFile();
      if (!file) continue;
      const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null;
      if (entry?.isDirectory) {
        folderFiles.push(file);
      } else {
        files.push(file);
      }
    }
    // Fall through to the `dataTransfer.files` fallback when every
    // `getAsFile()` returned null (e.g. the split ran after the event loop
    // turned) — otherwise the drop would be silently swallowed.
    if (sawFileItem && (files.length > 0 || folderFiles.length > 0)) {
      return { files, folderFiles };
    }
  }

  // Fallback: no usable items list (e.g. synthetic events) — treat
  // everything in `files` as regular files, exactly as before.
  return { files: Array.from(dataTransfer.files ?? []), folderFiles };
}
