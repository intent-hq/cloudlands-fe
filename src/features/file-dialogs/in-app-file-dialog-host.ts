/**
 * Split a save dialog's `defaultPath` (a bare file name or a full path) into
 * the folder to open and the file name to prefill.
 */
export function saveDefaults(defaultPath: string | undefined): {
  directory?: string;
  fileName: string;
} {
  const value = defaultPath?.trim() ?? '';
  const slash = value.lastIndexOf('/');
  if (slash < 0) return { fileName: value };
  return { directory: value.slice(0, slash) || '/', fileName: value.slice(slash + 1) };
}
