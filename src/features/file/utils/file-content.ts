import type {
  EditableText,
  FileContent,
  FileContentData,
  FileContentEntry,
  RestorableSnapshot,
} from '$store/renderer/slices/files/files-types';

export function editableText(content: string): EditableText {
  return { kind: 'editable-text', content };
}

export function fileContentData(content: FileContent): FileContentData {
  if (content.kind === 'preview-only') {
    return { ...content, originalContent: null, localContent: null };
  }
  const values = { originalContent: content.content, localContent: content.content };
  return content.kind === 'restorable-snapshot' && content.isBinary
    ? { ...values, kind: 'restorable-snapshot', isBinary: true }
    : { ...values, kind: 'editable-text', isBinary: false };
}

export function fileSnapshot(entry: FileContentEntry | undefined): RestorableSnapshot | undefined {
  if (!entry || entry.kind === 'preview-only' || entry.truncated) return undefined;
  return {
    kind: 'restorable-snapshot',
    content: entry.kind === 'editable-text' ? entry.localContent : entry.originalContent,
    isBinary: entry.isBinary,
  };
}
