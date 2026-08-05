/**
 * Text serialization helpers for the chat input TipTap editor.
 *
 * Defines the WYSIWYG plain-text convention for the chat input:
 * - a single visual line break (hardBreak / <br>) ↔ "\n"
 * - a paragraph boundary (blank line) ↔ "\n\n"
 *
 * `plainTextToEditorHTML` maps plain text → editor HTML and
 * `serializeEditorText` is its inverse (editor doc → plain text). The two
 * must stay in sync so the round trip is lossless and the external-value
 * comparison in TipTapEditor.svelte does not oscillate.
 */
import type { Editor } from '@tiptap/core';
import type { Node as PMNode, Schema } from '@tiptap/pm/model';
import { injectMentionSpans } from '$lib/utils/markdown-mention-injector';

/**
 * Group lines into paragraphs: consecutive non-empty lines form one
 * paragraph, empty lines start a new one. Empty groups are dropped.
 */
function groupLinesIntoParagraphs(lines: string[]): string[][] {
  const paragraphs: string[][] = [[]];
  for (const line of lines) {
    if (line === '') {
      paragraphs.push([]);
    } else {
      paragraphs[paragraphs.length - 1].push(line);
    }
  }
  return paragraphs.filter((p) => p.length > 0);
}

/**
 * Convert plain text to simple paragraph HTML for the TipTap editor.
 * Unlike processMarkdownToHTML (which runs marked.parse and converts markdown
 * syntax like "- item" to <ul><li> and "**bold**" to <strong>), this function
 * preserves all literal characters (dashes, asterisks, etc.) as-is.
 * Only @-mention tokens are rehydrated into mention chip spans.
 *
 * This prevents TipTap from stripping formatting — since formatting extensions
 * (bulletList, bold, etc.) are intentionally disabled in the input editor,
 * markdown-generated HTML tags would be silently removed.
 */
export function plainTextToEditorHTML(text: string): string {
  if (!text || text.trim() === '') return '';

  // If the value is already HTML (e.g., from comment editing where the caller
  // pre-processes markdown → HTML via processMarkdownToHTML), pass it through
  // directly. This matches the old processMarkdownToHTML skipIfHTML behavior.
  const trimmed = text.trim();
  if (trimmed.startsWith('<') && !trimmed.startsWith('<!--anchor:')) {
    return text;
  }

  // Process line-by-line to escape HTML and preserve leading whitespace
  const lines = text.split('\n');
  const processedLines = lines.map((line) => {
    if (line === '') return ''; // empty-line marker for paragraph splitting

    // Escape HTML entities so user text is safe
    let escaped = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Preserve leading spaces as &nbsp; so indentation is visible in HTML
    // (browsers collapse leading whitespace in normal flow)
    escaped = escaped.replace(/^ +/, (spaces) => '&nbsp;'.repeat(spaces.length));

    return escaped;
  });

  // Build HTML: each paragraph group → <p>, lines within joined by <br>
  const html = groupLinesIntoParagraphs(processedLines)
    .map((p) => `<p>${p.join('<br>')}</p>`)
    .join('');

  // Rehydrate @-mentions into TipTap mention chip spans
  return injectMentionSpans(html);
}

/**
 * Serialize the editor document to plain text, inverting
 * plainTextToEditorHTML: hardBreak → "\n", paragraph boundary → "\n\n",
 * leading &nbsp; indentation → regular spaces.
 */
export function serializeEditorText(editor: Editor | null | undefined): string {
  const raw =
    editor?.getText({
      blockSeparator: '\n\n',
      textSerializers: { hardBreak: () => '\n' },
    }) ?? '';

  // Invert the leading-space → &nbsp; escaping from plainTextToEditorHTML
  return raw
    .split('\n')
    .map((line) => line.replace(/^\u00A0+/, (nbsp) => ' '.repeat(nbsp.length)))
    .join('\n');
}

/**
 * Convert pasted plain text into paragraph nodes following the same
 * convention as plainTextToEditorHTML: single "\n" → hardBreak within a
 * paragraph, blank line → paragraph split.
 */
export function pastedTextToParagraphNodes(schema: Schema, text: string): PMNode[] {
  const normalized = text.replace(/\r\n?/g, '\n');
  return groupLinesIntoParagraphs(normalized.split('\n')).map((lines) => {
    const inline: PMNode[] = [];
    lines.forEach((line, index) => {
      if (index > 0) inline.push(schema.nodes.hardBreak.create());
      inline.push(schema.text(line));
    });
    return schema.nodes.paragraph.create(null, inline);
  });
}
