import { DOMSerializer } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import { processHTMLToMarkdown } from './markdown-processor';

export function serializeSelectionToMarkdown(view: EditorView): string | null {
  const { state } = view;

  if (state.selection.empty || typeof document === 'undefined') {
    return null;
  }

  const slice = state.selection.content();
  if (slice.content.size === 0) {
    return null;
  }

  const container = document.createElement('div');
  const serializer = DOMSerializer.fromSchema(state.schema);
  container.appendChild(serializer.serializeFragment(slice.content, { document }));

  const html = container.innerHTML;
  if (!html.trim()) {
    return null;
  }

  const markdown = processHTMLToMarkdown(html, { preserveAnchors: false }).trim();
  return markdown || null;
}

export function handleNoteEditorCopyAsMarkdown(view: EditorView, event: ClipboardEvent): boolean {
  try {
    const markdown = serializeSelectionToMarkdown(view);
    if (!markdown || !event.clipboardData) {
      return false;
    }

    event.clipboardData.setData('text/plain', markdown);
    event.preventDefault();
    return true;
  } catch {
    return false;
  }
}