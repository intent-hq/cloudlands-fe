/**
 * Text serialization helpers for the chat input TipTap editor.
 *
 * Defines the WYSIWYG plain-text convention for the chat input:
 * - every "\n" ↔ exactly one hardBreak (<br>)
 * - plain text maps to a single paragraph — no paragraph splitting — so
 *   consecutive, leading, and trailing newlines all survive the round trip
 *   (blank lines are represented as consecutive hardBreaks)
 *
 * `plainTextToEditorHTML` maps plain text → editor HTML and
 * `serializeEditorText` is its inverse (editor doc → plain text). The two
 * must stay in sync so the round trip is lossless and the external-value
 * comparison in TipTapEditor.svelte does not oscillate.
 */
import type { Editor } from '@tiptap/core';
import type { Node as PMNode, Schema } from '@tiptap/pm/model';
import { injectMentionSpans } from '$lib/utils/markdown-mention-injector';

function preserveCollapsibleSpaces(text: string): string {
  return text
    .replace(/^ +| +$/g, (spaces) => '\u00A0'.repeat(spaces.length))
    .replace(/ {2,}/g, (spaces) => ` ${'\u00A0'.repeat(spaces.length - 1)}`);
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
  if (!text) return '';

  // If the value is already HTML (e.g., from comment editing where the caller
  // pre-processes markdown → HTML via processMarkdownToHTML), pass it through
  // directly. This matches the old processMarkdownToHTML skipIfHTML behavior.
  const trimmed = text.trim();
  if (trimmed.startsWith('<') && !trimmed.startsWith('<!--anchor:')) {
    return text;
  }

  // Process line-by-line to escape HTML and preserve whitespace that HTML
  // parsing would otherwise collapse. A single internal space stays breakable.
  const processedLines = text.split('\n').map((line) => {
    if (line === '') return '';

    // Escape HTML entities so user text is safe
    const escaped = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    return preserveCollapsibleSpaces(escaped);
  });

  // Build HTML: one paragraph, one <br> per "\n". No paragraph splitting, so
  // consecutive/leading/trailing newlines are preserved exactly.
  const html = `<p>${processedLines.join('<br>')}</p>`;

  // Rehydrate @-mentions into TipTap mention chip spans
  return injectMentionSpans(html);
}

/**
 * Serialize the editor document to plain text, inverting
 * plainTextToEditorHTML: hardBreak → "\n", preserved non-breaking whitespace
 * → regular spaces. Paragraph boundaries (possible via the HTML pass-through
 * path) still serialize as "\n\n".
 */
export function serializeEditorText(editor: Editor | null | undefined): string {
  const raw =
    editor?.getText({
      blockSeparator: '\n\n',
      textSerializers: { hardBreak: () => '\n' },
    }) ?? '';

  // Invert the whitespace preservation from plainTextToEditorHTML.
  return raw.replace(/\u00A0/g, ' ');
}

/**
 * Convert pasted plain text into paragraph nodes following the same
 * convention as plainTextToEditorHTML: every "\n" → one hardBreak inside a
 * single paragraph (blank lines become consecutive hardBreaks).
 */
export function pastedTextToParagraphNodes(schema: Schema, text: string): PMNode[] {
  const normalized = text.replace(/\r\n?/g, '\n');
  const inline: PMNode[] = [];
  normalized.split('\n').forEach((line, index) => {
    if (index > 0) inline.push(schema.nodes.hardBreak.create());
    if (line !== '') inline.push(schema.text(line));
  });
  return [schema.nodes.paragraph.create(null, inline)];
}
