import type { DraftSource } from '$shared/types/workspace-draft';

export type NewFolderNameError =
  'required' | 'path-separator' | 'dot-name' | 'null-character' | 'invalid-character' | 'too-long';

export function getNewFolderNameError(name: string): NewFolderNameError | undefined {
  const trimmed = name.trim();
  if (!trimmed) return 'required';
  if (trimmed.includes('/') || trimmed.includes('\\')) return 'path-separator';
  if (trimmed === '.' || /^\.+$/.test(trimmed)) return 'dot-name';
  if (trimmed.includes('\0')) return 'null-character';
  if (/[<>:"|?*]/.test(trimmed)) return 'invalid-character';
  if (trimmed.length > 255) return 'too-long';
  return undefined;
}

export function getSourceValidationError(
  source: DraftSource | null,
): NewFolderNameError | undefined {
  return source?.kind === 'newFolder' ? getNewFolderNameError(source.name) : undefined;
}

export function isSourceValid(source: DraftSource | null): boolean {
  return getSourceValidationError(source) === undefined;
}
