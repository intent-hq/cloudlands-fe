import { ReplaceStep } from '@tiptap/pm/transform';
import { commandHistory } from './command-history';
import type { CommandProps, Editor, JSONContent } from '@tiptap/core';
import { Table } from '@tiptap/extension-table';
import { Slice, type Node as PMNode } from '@tiptap/pm/model';
import { EditorState, TextSelection, type Transaction } from '@tiptap/pm/state';
import { CellSelection, tableEditing, deleteCellSelection } from '@tiptap/pm/tables';
import { bytes } from './bounded-note-service';

export const tableCommands = [
  'addRowBefore',
  'addRowAfter',
  'deleteRow',
  'deleteTable',
  'addColumnBefore',
  'addColumnAfter',
  'deleteColumn',
  'mergeCells',
  'splitCell',
  'toggleHeaderRow',
  'toggleHeaderColumn',
  'toggleHeaderCell',
  'mergeOrSplit',
] as const;
export type TableCommandName =
  | (typeof tableCommands)[number]
  | 'deleteSelection'
  | 'deleteCellSelection'
  | 'normalizeLeadingBoundary'
  | 'replaceSelection';
export type TableCommandSlice = { content?: JSONContent[]; openStart?: number; openEnd?: number };

/** External mock backing computation, never a mounted editor or renderer reply.
 * Invoke the locked native command, including Tiptap's cursor retention wrappers.
 * No EditorView, layout or full-table DOM is created here. */
export function applyNativeTableCommand(
  doc: PMNode,
  anchor: number,
  head: number,
  kind: 'text' | 'cell',
  name: TableCommandName,
  editor: Editor,
  dispatch = true,
  slice?: TableCommandSlice,
  replacement?: { from: number; to: number; anchor: number; head: number },
  preserve?: { anchor: number; head: number },
) {
  const state = EditorState.create({
    doc,
    schema: editor.schema,
    plugins: [tableEditing()],
    selection:
      kind === 'cell'
        ? CellSelection.create(doc, anchor, head)
        : TextSelection.create(doc, anchor, head),
  });
  const commands = Table.config.addCommands!.call({
    name: Table.name,
    options: Table.options,
    storage: Table.storage,
    editor,
    type: editor.schema.nodes.table,
    parent: undefined,
  });
  let transaction: Transaction | undefined;
  const props = new Proxy(
    {
      state,
      tr: state.tr,
      dispatch: dispatch
        ? (tr: Transaction) => {
            transaction = tr;
          }
        : undefined,
    },
    {
      get(target, key) {
        if (!(key in target))
          throw new Error(`Backing table command requested renderer capability ${String(key)}`);
        return Reflect.get(target, key);
      },
    },
  ) as CommandProps;
  const clear = () => deleteCellSelection(state, props.dispatch);
  const runDelete = () => {
    // Reuse the locked native shortcut's whole-table decision with only this
    // backing state and its existing deleteTable command capability.
    const backingEditor = new Proxy(
      { state, commands: { deleteTable: () => commands.deleteTable!()(props) } },
      {
        get(target, key) {
          if (!(key in target))
            throw new Error(`Backing table shortcut requested renderer capability ${String(key)}`);
          return Reflect.get(target, key);
        },
      },
    ) as unknown as Editor;
    const shortcuts = Table.config.addKeyboardShortcuts!.call({ editor: backingEditor } as never);
    return shortcuts.Delete!({ editor: backingEditor }) || clear();
  };
  const normalizeBoundary = () => {
    // The existing backing document has a table followed by a paragraph. Replay
    // the real raw leading-table boundary; locked tableEditing decides its range.
    transaction = state.tr.setSelection(
      TextSelection.between(doc.resolve(doc.firstChild!.nodeSize + 1), doc.resolve(1)),
    );
    return true;
  };
  const replace = () => {
    if (!slice) throw new Error('Missing native replacement slice');
    if (dispatch) {
      transaction = replacement
        ? state.tr.step(
            new ReplaceStep(replacement.from, replacement.to, Slice.fromJSON(editor.schema, slice)),
          )
        : preserve
          ? state.tr.step(
              new ReplaceStep(
                Math.min(anchor, head),
                Math.max(anchor, head),
                Slice.fromJSON(editor.schema, slice),
              ),
            )
          : state.tr.replaceSelection(Slice.fromJSON(editor.schema, slice));
      if (replacement)
        transaction.setSelection(
          TextSelection.create(transaction.doc, replacement.anchor, replacement.head),
        );
      if (preserve)
        transaction.setSelection(
          TextSelection.create(doc, preserve.anchor, preserve.head).map(
            transaction.doc,
            transaction.mapping,
          ),
        );
    }
    return true;
  };
  const accepted =
    name === 'normalizeLeadingBoundary'
      ? normalizeBoundary()
      : name === 'replaceSelection'
        ? replace()
        : name === 'deleteCellSelection'
          ? clear()
          : name === 'deleteSelection'
            ? runDelete()
            : commands[name]!()(props);
  const applied = transaction ? state.applyTransaction(transaction) : { state, transactions: [] };
  const result = applied.state;
  let nodes = 0;
  doc.descendants(() => {
    nodes++;
  });
  result.doc.descendants(() => {
    nodes++;
  });
  return {
    accepted,
    history: commandHistory(applied.transactions),
    state: result,
    costs: {
      nodes,
      serializedBytes:
        bytes(JSON.stringify(doc.toJSON())) + bytes(JSON.stringify(result.doc.toJSON())),
    },
  };
}
