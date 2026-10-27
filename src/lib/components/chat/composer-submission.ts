import type { ContextItem } from './input/context-api';
import type {
  PanelContextItem,
  SelectionContextItem,
} from '$store/renderer/slices/multi-panel-context/multi-panel-context-slice';
import { appendContextItemContent } from './browser-capture-context';

/** Canonical composer DOM snapshots share one wire/context projection. */
export function extractAttachmentBlocks(items: ContextItem[]) {
  const imageBlocks = items
    .filter((item) => (item.imageData || item.attachmentId) && item.imageMimeType)
    .map((item) =>
      item.attachmentId
        ? {
            type: 'image' as const,
            attachmentId: item.attachmentId,
            // The neutral 'image' marker (reference restored without a
            // persisted mime) stays off the wire — mimeType is optional
            // on the reference arm.
            ...(item.imageMimeType!.includes('/') ? { mimeType: item.imageMimeType! } : {}),
          }
        : {
            type: 'image' as const,
            data: item.imageData!,
            mimeType: item.imageMimeType!,
          },
    );
  const fileBlocks = items
    .filter((item) => item.attachmentId && !item.imageMimeType)
    .map((item) => ({
      type: 'file' as const,
      attachmentId: item.attachmentId!,
      fileName: item.label,
      ...(item.attachmentMimeType ? { mimeType: item.attachmentMimeType } : {}),
      ...(item.attachmentSize !== undefined ? { size: item.attachmentSize } : {}),
    }));
  return { imageBlocks, fileBlocks };
}

export function buildWorkspaceContextString(
  items: ContextItem[] = [],
  checkedPanels: PanelContextItem[] = [],
  checkedSelections: SelectionContextItem[] = [],
): string {
  const parts: string[] = [];

  // Add context from checked panels in the multi-panel context store
  for (const panel of checkedPanels) {
    if (panel.type === 'file' && panel.filePath) {
      // i18n-ignore (agent-directed context marker, not user-facing UI)
      parts.push(`[Currently viewing file: ${panel.filePath}]`);
    } else if (panel.type === 'diff' && panel.filePath) {
      // i18n-ignore (agent-directed context marker, not user-facing UI)
      parts.push(`[Currently viewing diff for: ${panel.filePath}]`);
    } else if (panel.type === 'note' && panel.noteId) {
      parts.push(
        // i18n-ignore (agent-directed context marker, not user-facing UI)
        `[Currently viewing note: "${panel.label}" (ID: ${panel.noteId}). Use read_note_space-mcp(noteId="${panel.noteId}") to read its content.]`,
      );
    } else if (panel.type === 'spec') {
      // i18n-ignore (agent-directed context marker, not user-facing UI)
      parts.push('[Currently viewing: Spec]');
    } else if (panel.type === 'browser' && panel.browserUrl) {
      // i18n-ignore (agent-directed context marker, not user-facing UI)
      parts.push(`[Currently viewing browser: ${panel.browserUrl}]`);
    }
  }

  // Add checked selections from multi-panel context store
  for (const selection of checkedSelections) {
    const selectedText = selection.text.trim();
    const displayText =
      selectedText.length > 500 ? selectedText.substring(0, 500) + '...' : selectedText;
    const source = selection.sourceLabel ? ` from ${selection.sourceLabel}` : '';
    // i18n-ignore (agent-directed context marker, not user-facing UI)
    parts.push(`[Selected text${source}:\n\`\`\`\n${displayText}\n\`\`\`]`);
  }

  return appendContextItemContent(parts.join('\n'), items);
}
