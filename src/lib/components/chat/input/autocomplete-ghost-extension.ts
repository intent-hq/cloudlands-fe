/**
 * Composer autocomplete ghost text (Contract §6.3): a muted suggestion drawn
 * after the caret as a ProseMirror widget decoration — never document
 * content, so it is not serialized, sent or saved as a draft.
 *
 * - Tab accepts (inserts the ghost at the end of the draft).
 * - Esc dismisses.
 * - Typing characters that match the ghost consumes them; any other edit,
 *   programmatic content change or caret move away from the end clears it.
 *
 * The request side (debounce, trigger rules, stale-drop) lives in
 * `$features/autocomplete/utils/autocomplete-controller`.
 */
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, Selection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { consumeGhost } from '$features/autocomplete/utils/ghost-consumption';

export const autocompleteGhostPluginKey = new PluginKey<string | null>('autocompleteGhost');

/** Transaction meta marking the Tab-accept insertion. */
export const AUTOCOMPLETE_GHOST_ACCEPTED = 'autocompleteGhostAccepted';

/** The `<kbd>` hint is a key name, not translatable copy. */
const ACCEPT_KEY_LABEL = 'Tab'; // i18n-ignore (key name)

export function ghostDocText(doc: ProseMirrorNode): string {
  return doc.textBetween(0, doc.content.size, '\n', '￼');
}

export function isCaretAtDocEnd(state: EditorState): boolean {
  const { selection, doc } = state;
  return selection.empty && selection.head === Selection.atEnd(doc).head;
}

function nextGhost(
  tr: Transaction,
  previous: string | null,
  oldState: EditorState,
  newState: EditorState,
): string | null {
  const meta = tr.getMeta(autocompleteGhostPluginKey) as string | null | undefined;
  if (meta !== undefined) return meta ? meta : null;
  if (!previous) return null;
  if (tr.docChanged) {
    if (tr.getMeta('external-update')) return null;
    if (!isCaretAtDocEnd(newState)) return null;
    return consumeGhost(previous, ghostDocText(oldState.doc), ghostDocText(newState.doc));
  }
  if (tr.selectionSet && !isCaretAtDocEnd(newState)) return null;
  return previous;
}

export function getAutocompleteGhost(state: EditorState): string | null {
  return autocompleteGhostPluginKey.getState(state) ?? null;
}

export function setAutocompleteGhost(view: EditorView, ghost: string | null): void {
  if (ghost && !isCaretAtDocEnd(view.state)) return;
  if (getAutocompleteGhost(view.state) === (ghost || null)) return;
  view.dispatch(view.state.tr.setMeta(autocompleteGhostPluginKey, ghost || null));
}

/** Insert the ghost at the end of the draft. */
export function acceptAutocompleteGhost(view: EditorView): boolean {
  const ghost = getAutocompleteGhost(view.state);
  if (!ghost || !isCaretAtDocEnd(view.state)) return false;
  const end = Selection.atEnd(view.state.doc).head;
  view.dispatch(
    view.state.tr
      .insertText(ghost, end)
      .setMeta(autocompleteGhostPluginKey, null)
      .setMeta(AUTOCOMPLETE_GHOST_ACCEPTED, true)
      .scrollIntoView(),
  );
  return true;
}

/**
 * Tab / Esc while a ghost is shown. Exported so the composer can run it ahead
 * of its own Escape handling (editor props outrank plugin props).
 */
export function handleAutocompleteGhostKeyDown(view: EditorView, event: KeyboardEvent): boolean {
  if (!getAutocompleteGhost(view.state)) return false;
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false;
  if (event.key === 'Tab') {
    if (!acceptAutocompleteGhost(view)) return false;
    event.preventDefault();
    return true;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    view.dispatch(view.state.tr.setMeta(autocompleteGhostPluginKey, null));
    return true;
  }
  return false;
}

function createGhostElement(ghost: string): HTMLElement {
  const root = document.createElement('span');
  root.className = 'composer-autocomplete-ghost';
  root.contentEditable = 'false';
  root.dataset.testid = 'composer-autocomplete-ghost';
  root.setAttribute('aria-hidden', 'true');
  const text = document.createElement('span');
  text.className = 'composer-autocomplete-ghost-text';
  text.textContent = ghost;
  const kbd = document.createElement('kbd');
  kbd.textContent = ACCEPT_KEY_LABEL;
  root.append(text, kbd);
  return root;
}

export const AutocompleteGhostExtension = Extension.create({
  name: 'autocompleteGhost',

  addProseMirrorPlugins() {
    return [
      new Plugin<string | null>({
        key: autocompleteGhostPluginKey,
        state: {
          init: () => null,
          apply: (tr, previous, oldState, newState) => nextGhost(tr, previous, oldState, newState),
        },
        props: {
          handleKeyDown: handleAutocompleteGhostKeyDown,
          decorations(state) {
            const ghost = autocompleteGhostPluginKey.getState(state);
            if (!ghost) return DecorationSet.empty;
            const position = Selection.atEnd(state.doc).head;
            return DecorationSet.create(state.doc, [
              Decoration.widget(position, () => createGhostElement(ghost), {
                key: `composer-autocomplete-ghost:${ghost}`,
                side: 1,
                ignoreSelection: true,
              }),
            ]);
          },
        },
      }),
    ];
  },
});
