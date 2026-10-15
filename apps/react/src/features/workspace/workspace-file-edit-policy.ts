import { MAX_CODE_EDITOR_CONTENT_SIZE } from '$lib/utils/code-editor-policy';

/** Monaco normalizes mixed/lone CR endings; those files remain read-only in this bounded host. */
export function canEditWorkspaceText(content: string): boolean {
  const hasCRLF = content.includes('\r\n');
  const withoutCRLF = content.replaceAll('\r\n', '');
  return (
    new TextEncoder().encode(content).byteLength <= MAX_CODE_EDITOR_CONTENT_SIZE &&
    !withoutCRLF.includes('\r') &&
    !(hasCRLF && withoutCRLF.includes('\n'))
  );
}
