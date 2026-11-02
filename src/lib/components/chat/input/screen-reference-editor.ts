import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { TextSelection, type Transaction } from '@tiptap/pm/state';
import { chipDeletionRange } from '$lib/components/tiptap/ScreenReference';
import type {
  EditorScreenReference,
  DockEvidenceInsertion,
  DockReferenceEdit,
} from '$shared/dock-evidence';

export const SCREEN_REFERENCE_SYNC = 'screen-reference-sync';
export const SCREEN_EVIDENCE_INSERTION = 'screen-evidence-insertion';

/** Token text a reference serializes to (marks and recording start/end points). */
function referenceToken(reference: EditorScreenReference): string {
  if (reference.kind === 'clip-start') return `[[clip:${reference.number}]]`;
  if (reference.kind === 'clip-end') return `[[clip:${reference.number}:end]]`;
  return `[[mark:${reference.number}]]`;
}

/** Hydrate only known references in text nodes; never rewrite HTML attributes or other chips. */
export function hydrateScreenReferences(
  html: string,
  references: readonly EditorScreenReference[],
): string {
  if (references.length === 0 || !/\[\[(mark|clip):/.test(html)) return html;
  const byToken = new Map(references.map((reference) => [referenceToken(reference), reference]));
  const template = document.createElement('template');
  template.innerHTML = html;
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    if (node.parentElement?.closest('[contenteditable="false"]')) continue;
    const text = node.data;
    const matches = [...text.matchAll(/\[\[(?:mark:[1-9]\d*|clip:[1-9]\d*(?::end)?)\]\]/g)];
    if (!matches.some((match) => byToken.has(match[0]))) continue;
    const replacement = document.createDocumentFragment();
    let offset = 0;
    for (const match of matches) {
      const reference = byToken.get(match[0]);
      if (!reference) continue;
      replacement.append(text.slice(offset, match.index));
      const chip = document.createElement('span');
      chip.dataset.screenReference = reference.id;
      chip.textContent = reference.kind ? reference.label : String(reference.number);
      replacement.append(chip);
      offset = match.index + match[0].length;
    }
    replacement.append(text.slice(offset));
    node.replaceWith(replacement);
  }
  return template.innerHTML;
}

/** Update by stable identity, so deleting mark 1 never relabels it as the old mark 2. */
export function synchronizeScreenReferences(
  editor: Editor,
  references: readonly EditorScreenReference[],
): boolean {
  if (editor.isDestroyed || editor.view.composing) return false;
  const byId = new Map(references.map((reference) => [reference.id, reference]));
  const tr = editor.state.tr;
  editor.state.doc.descendants((node, position) => {
    if (node.type.name !== 'screenReference') return;
    const reference = byId.get(node.attrs.id);
    const mapped = tr.mapping.map(position);
    if (!reference) tr.delete(...chipDeletionRange(tr.doc, mapped, mapped + node.nodeSize));
    else if (
      node.attrs.number !== reference.number ||
      node.attrs.label !== reference.label ||
      (node.attrs.kind ?? null) !== (reference.kind ?? null)
    )
      tr.setNodeMarkup(mapped, undefined, { kind: null, ...reference });
  });
  if (!tr.docChanged) return false;
  // Evidence ownership handles undo; visual renumbering must not become a text undo step.
  tr.setMeta('addToHistory', false).setMeta(SCREEN_REFERENCE_SYNC, true);
  editor.view.dispatch(tr);
  return true;
}

/**
 * Turn raw reference tokens that are already in the document into chips. A restored
 * draft's text can reach the editor before its evidence references; the tokens then
 * stay plain text (they serialize to the same text, so the controlled value never
 * re-hydrates them). Only tokens naming a known reference become chips.
 */
export function hydrateScreenTokens(
  editor: Editor,
  references: readonly EditorScreenReference[],
): boolean {
  const type = editor.schema.nodes.screenReference;
  if (editor.isDestroyed || editor.view.composing || !type || references.length === 0) return false;
  const byToken = new Map(references.map((reference) => [referenceToken(reference), reference]));
  const found: { from: number; to: number; reference: EditorScreenReference }[] = [];
  editor.state.doc.descendants((node, position) => {
    if (!node.isText || !node.text || !node.text.includes('[[')) return;
    for (const match of node.text.matchAll(/\[\[(?:mark:[1-9]\d*|clip:[1-9]\d*(?::end)?)\]\]/g)) {
      const reference = byToken.get(match[0]);
      if (reference)
        found.push({
          from: position + match.index,
          to: position + match.index + match[0].length,
          reference,
        });
    }
  });
  if (found.length === 0) return false;
  const tr = editor.state.tr;
  for (const { from, to, reference } of found.reverse())
    tr.replaceWith(from, to, type.create({ kind: null, ...reference }));
  // Same document text; not an undo step.
  tr.setMeta('addToHistory', false).setMeta(SCREEN_REFERENCE_SYNC, true);
  editor.view.dispatch(tr);
  return true;
}

/** Insert a single accepted narration/reference event at the retained selection without focusing. */
export function insertScreenEvidence(
  editor: Editor,
  insertion: DockEvidenceInsertion,
  references: readonly EditorScreenReference[],
  /**
   * The dictation's speech point (mapped through every edit). When given, words
   * land there, not at the selection, which can jump when the window regains focus.
   */
  at?: number,
): boolean {
  if (editor.isDestroyed || editor.view.composing || !editor.isEditable) return false;
  const byId = new Map(references.map((reference) => [reference.id, reference]));
  if (insertion.parts.some((part) => part.kind === 'mark' && !byId.has(part.markId))) return false;
  const nodes = insertion.parts.flatMap((part) => {
    if (part.kind === 'mark') {
      const reference = byId.get(part.markId);
      if (!reference) return [];
      return [editor.schema.nodes.screenReference.create({ kind: null, ...reference })];
    }
    const result = [];
    const lines = part.text.replace(/\r\n?/g, '\n').split('\n');
    for (let index = 0; index < lines.length; index++) {
      if (index > 0) result.push(editor.schema.nodes.hardBreak.create());
      if (lines[index]) result.push(editor.schema.text(lines[index]));
    }
    return result;
  });
  if (nodes.length === 0) return true;
  const content = nodes.map((node) => node.toJSON());
  const doc = editor.state.doc;
  const point =
    at === undefined
      ? undefined
      : TextSelection.near(doc.resolve(Math.max(0, Math.min(at, doc.content.size)))).from;
  return (
    editor
      .chain()
      .setMeta(SCREEN_EVIDENCE_INSERTION, insertion.id)
      .command(({ commands }) =>
        point === undefined
          ? commands.insertContent(content, { updateSelection: true })
          : commands.insertContentAt(point, content, { updateSelection: true }),
      )
      // The caret follows the committed words and stays visible.
      .scrollIntoView()
      .run()
  );
}

function referenceIds(doc: ProseMirrorNode): string[] {
  const ids: string[] = [];
  doc.descendants((node) => {
    if (node.type.name === 'screenReference' && node.attrs.id) ids.push(node.attrs.id as string);
  });
  return ids;
}

/**
 * Chips a user edit removed from or brought back into the text (Backspace,
 * selection delete, cut, undo, redo, paste). Reference sync and evidence
 * insertions are owned by the evidence model and never count. Null when none.
 */
export function screenReferenceEdit(transaction: Transaction): DockReferenceEdit | null {
  if (
    !transaction.docChanged ||
    transaction.getMeta(SCREEN_REFERENCE_SYNC) ||
    transaction.getMeta(SCREEN_EVIDENCE_INSERTION)
  )
    return null;
  const before = referenceIds(transaction.before);
  const after = referenceIds(transaction.doc);
  const removed = before.filter((id) => !after.includes(id));
  const restored = after.filter((id) => !before.includes(id));
  return removed.length || restored.length ? { removed, restored } : null;
}
