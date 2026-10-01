import { Editor, Extension } from '@tiptap/core';
import { Plugin, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { createEditorConfig } from '$lib/utils/editor-config';
import { bytes } from './bounded-note-service';
import {
  LIMITS,
  SourceJournal,
  mapSelection,
  mapPoint,
  type Selection,
  type Change,
  type Splice,
} from './source-journal';
import { SourceProjection } from './source-projection';

/** Test-only logical document. Production editor, APIs, annotations and size guard are unchanged. */
export class DocumentSession {
  editor?: Editor;
  projection?: SourceProjection;
  selection: Selection = { anchor: 0, head: 0, affinity: 1, revision: 1 };
  active = -1;
  error = '';
  created = 0;
  destroyed = 0;
  parsedBytes = 0;
  maxParsedBytes = 0;
  inFlightBytes = 0;
  maxInFlightBytes = 0;
  acceptedRoots = 0;
  acceptedAppended = 0;
  private endId = 0;
  private cache = new Map<string, string>();
  private navigation = 0;
  private suppress = false;
  private prevTime = 0;
  private prevComposition: number | undefined;
  private prevRange?: [number, number];
  delayFetch?: () => Promise<void>;
  constructor(
    readonly service: SourceJournal,
    private host: HTMLElement,
    private changed = () => {},
  ) {}
  private project(source: string, start: number) {
    this.parsedBytes += bytes(source);
    this.maxParsedBytes = Math.max(this.maxParsedBytes, bytes(source));
    return new SourceProjection(source, start);
  }
  private readWindow(id: number) {
    const from = this.service.start(id),
      endId = Math.min(id + 2, this.service.count),
      to = this.service.start(endId);
    let source = '';
    for (let offset = from; offset < to;) {
      // UTF-16 span capped at 1024 => at most 4096 UTF-8 bytes, without splitting a surrogate.
      let end = Math.min(offset + 1024, to);
      const boundary = this.service.slice(end - 1, end + (end < to ? 1 : 0));
      if (end < to && /[\uD800-\uDBFF]/.test(boundary[0])) end--;
      const key = `${this.service.revision}:${offset}:${end}`;
      const page = this.cache.get(key) ?? this.service.read(offset, end).source;
      this.cache.delete(key);
      this.cache.set(key, page);
      while (this.cache.size > LIMITS.cachePages)
        this.cache.delete(this.cache.keys().next().value!);
      source += page;
      offset = end;
      if (bytes(source) > LIMITS.active)
        throw new Error('Proof projection exceeds experiment budget');
    }
    this.inFlightBytes = bytes(source);
    this.maxInFlightBytes = Math.max(this.maxInFlightBytes, this.inFlightBytes);
    return { source, from, endId };
  }
  async show(id: number, restore = false) {
    if (this.editor?.view.composing) {
      this.error = 'Composition pins current view';
      this.changed();
      return false;
    }
    const ticket = ++this.navigation;
    const revision = this.service.revision;
    const window = this.readWindow(id);
    if (this.delayFetch) await this.delayFetch();
    this.inFlightBytes = 0;
    if (
      ticket !== this.navigation ||
      revision !== this.service.revision ||
      this.editor?.view.composing
    ) {
      this.error = 'Stale or composing view pinned';
      this.changed();
      return false;
    }
    this.editor?.destroy();
    if (this.editor) this.destroyed++;
    this.active = id;
    this.endId = window.endId;
    this.projection = this.project(window.source, window.from);
    const decorations = (state: EditorState) => {
      const p = this.projection!;
      const result = this.service.annotations(
        p.start,
        p.start + p.source.length,
        this.service.revision,
        this.service.generation,
      );
      return DecorationSet.create(
        state.doc,
        result.items.flatMap((a) => {
          const from = p.pmAt(Math.max(a.from, p.start)),
            to = p.pmAt(Math.min(a.to, p.start + p.source.length), -1);
          return from < to ? [Decoration.inline(from, to, { 'data-proof-comment': a.id })] : [];
        }),
      );
    };
    const annotations = Extension.create({
      name: 'sourceAnchoredProof',
      addProseMirrorPlugins() {
        return [new Plugin({ props: { decorations } })];
      },
    });
    const config = createEditorConfig({
      element: this.host,
      content: '',
      editable: true,
      useMarkdown: true,
      enableComments: false,
      enableMentions: false,
      onUpdate: () => {},
    });
    this.suppress = true;
    this.editor = new Editor({
      ...config,
      content: this.projection.content,
      extensions: [
        ...config.extensions.map((ext) =>
          ext.name === 'starterKit' ? ext.configure({ ...ext.options, undoRedo: false }) : ext,
        ),
        annotations,
      ],
      onUpdate: () => {},
      onSelectionUpdate: () => {},
      onTransaction: ({ transaction, appendedTransactions }) =>
        this.accept([transaction, ...(appendedTransactions ?? [])]),
      editorProps: {
        ...config.editorProps,
        handleKeyDown: (_view, event) => {
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
            event.preventDefault();
            void this.history(event.shiftKey);
            return true;
          }
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
            event.preventDefault();
            this.selectAll();
            return true;
          }
          const p = this.projection!;
          const globalRange =
            this.selection.anchor < p.start ||
            this.selection.head < p.start ||
            this.selection.anchor > p.start + p.source.length ||
            this.selection.head > p.start + p.source.length;
          if (
            globalRange &&
            event.shiftKey &&
            (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
          ) {
            event.preventDefault();
            this.selection.head = Math.max(
              0,
              Math.min(
                this.service.length,
                this.selection.head + (event.key === 'ArrowLeft' ? -1 : 1),
              ),
            );
            this.suppress = true;
            this.renderSelection();
            this.suppress = false;
            this.changed();
            return true;
          }
          return false;
        },
      },
    });
    this.created++;
    if (
      !restore &&
      (this.selection.head < window.from ||
        this.selection.head > window.from + window.source.length)
    ) {
      // Navigation changes the viewport, not the durable document selection.
      this.editor.commands.setTextSelection(1);
    } else this.renderSelection();
    this.suppress = false;
    this.editor.view.focus();
    this.error = '';
    this.changed();
    return true;
  }
  private renderSelection() {
    const p = this.projection!,
      editor = this.editor!;
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(
          editor.state.doc,
          p.pmAt(this.selection.anchor, this.selection.affinity),
          p.pmAt(this.selection.head, this.selection.affinity),
        ),
      ),
    );
  }
  selectAll() {
    this.selection = {
      anchor: 0,
      head: this.service.length,
      affinity: 1,
      revision: this.service.revision,
    };
    this.suppress = true;
    this.renderSelection();
    this.suppress = false;
    this.changed();
  }
  private fromPM(selection: { anchor: number; head: number }): Selection {
    const p = this.projection!;
    return {
      anchor: p.sourceAt(selection.anchor),
      head: p.sourceAt(selection.head),
      affinity: selection.anchor <= selection.head ? 1 : -1,
      revision: this.service.revision,
    };
  }
  private accept(transactions: Transaction[]) {
    if (this.suppress) return;
    try {
      for (let index = 0; index < transactions.length; index++) {
        const tr = transactions[index];
        if (!tr.docChanged) {
          if (tr.selectionSet) this.selection = this.fromPM(tr.selection);
          continue;
        }
        if (index) this.acceptedAppended++;
        else this.acceptedRoots++;
        const before = this.fromPM(
          TextSelection.fromJSON(
            tr.before,
            tr.before === this.editor?.state.doc
              ? this.editor.state.selection.toJSON()
              : {
                  type: 'text',
                  anchor: this.projection!.pmAt(this.selection.anchor),
                  head: this.projection!.pmAt(this.selection.head),
                },
          ),
        );
        let adjacent = false;
        tr.mapping.maps[0]?.forEach((from, to) => {
          const start = this.projection!.sourceAt(from),
            end = this.projection!.sourceAt(to);
          if (this.prevRange && start <= this.prevRange[1] && end >= this.prevRange[0])
            adjacent = true;
        });
        const anchorsBefore = structuredClone(this.service.anchors);
        const changes: Change[] = [];
        const oldStart = this.projection!.start;
        for (let n = 0; n < tr.steps.length; n++) {
          for (const splice of this.projection!.translate(tr.steps[n], tr.docs[n]))
            changes.push(this.service.apply(splice));
          this.projection = this.project(
            this.service.slice(oldStart, this.service.start(this.endId)),
            oldStart,
          );
        }
        const after = this.fromPM(tr.selection);
        const composition = tr.getMeta('composition');
        const group =
          this.prevTime !== 0 &&
          (index > 0 ||
            (composition !== undefined && composition === this.prevComposition) ||
            (tr.time - this.prevTime <= 500 && !!adjacent));
        this.service.record(
          {
            changes,
            before,
            after,
            anchorsBefore,
            anchorsAfter: structuredClone(this.service.anchors),
          },
          group,
        );
        this.prevRange = undefined;
        for (let m = tr.mapping.maps.length - 1; m >= 0 && !this.prevRange; m--) {
          tr.mapping.maps[m].forEach((_from, _to, from, to) => {
            this.prevRange = [this.projection!.sourceAt(from), this.projection!.sourceAt(to)];
          });
        }
        this.prevTime = tr.time;
        if (composition !== undefined) this.prevComposition = composition;
        this.selection = after;
        this.cache.clear();
      }
      // Decoration props requery source anchors after all accepted appended transactions.
      this.editor?.view.setProps({});
      this.changed();
    } catch (error) {
      this.error = String(error);
      this.changed();
    }
  }
  async history(redo = false) {
    const index = redo ? this.service.cursor : this.service.cursor - 1;
    if (index < 0 || index >= this.service.depth) return false;
    const event = this.service.event(index);
    this.service.bookmark(index, redo ? 'before' : 'after', this.selection);
    for (const change of this.service.changes(index, !redo))
      this.service.apply(
        redo
          ? change
          : { from: change.from, to: change.from + change.insert.length, insert: change.removed },
      );
    this.service.anchors = structuredClone(redo ? event.anchorsAfter : event.anchorsBefore);
    this.selection = { ...(redo ? event.after : event.before), revision: this.service.revision };
    this.service.cursor += redo ? 1 : -1;
    this.prevTime = 0;
    this.cache.clear();
    await this.show(
      Math.min(this.service.locate(this.selection.head).id, this.service.count - 2),
      true,
    );
    return true;
  }
  save() {
    this.service.save();
    this.changed();
  }
  copy() {
    return this.service.slice(
      Math.min(this.selection.anchor, this.selection.head),
      Math.max(this.selection.anchor, this.selection.head),
    );
  }
  /** Source-level adapters exercise ranges larger than the mounted document without hydration. */
  async replaceSelection(insert: string) {
    const before = { ...this.selection },
      anchorsBefore = structuredClone(this.service.anchors);
    const from = Math.min(before.anchor, before.head),
      to = Math.max(before.anchor, before.head);
    const change = this.service.apply({ from, to, insert });
    this.selection = {
      anchor: from + insert.length,
      head: from + insert.length,
      affinity: 1,
      revision: this.service.revision,
    };
    this.service.record(
      {
        changes: [change],
        before,
        after: this.selection,
        anchorsBefore,
        anchorsAfter: structuredClone(this.service.anchors),
      },
      false,
    );
    this.prevTime = 0;
    this.cache.clear();
    await this.show(this.service.locate(from).id, true);
  }
  remote(splice: Splice) {
    // This narrow proof conservatively rejects overlap with any retained local history.
    for (let i = 0; i < this.service.cursor; i++)
      for (const change of this.service.changes(i)) {
        if (splice.from < change.from + change.insert.length && splice.to > change.from)
          throw new Error('Conflict: retained draft and journal');
      }
    const oldStart = this.projection!.start;
    this.service.apply(splice);
    this.service.rebase(splice);
    this.selection = mapSelection(this.selection, splice, this.service.revision);
    if (this.prevRange)
      this.prevRange = [mapPoint(this.prevRange[0], splice), mapPoint(this.prevRange[1], splice)];
    this.cache.clear();
    if (splice.to <= oldStart) {
      const start = mapPoint(oldStart, splice);
      this.projection = this.project(
        this.service.slice(start, this.service.start(this.endId)),
        start,
      );
      this.editor?.view.setProps({});
      this.changed();
    } else void this.show(this.active, true);
  }
  snapshot() {
    let nodes = 0;
    this.editor?.state.doc.descendants(() => {
      nodes++;
    });
    const pluginStates =
      this.editor?.state.plugins
        .map((plugin) => plugin.getState(this.editor!.state))
        .filter((value) => value !== undefined) ?? [];
    const seen = new WeakSet<object>();
    const pluginPayload = JSON.stringify(pluginStates, (_key, value) => {
      if (value && typeof value === 'object') {
        if (seen.has(value)) return '[shared reference]';
        seen.add(value);
      }
      return value;
    });
    return {
      pluginStateFields: pluginStates.length,
      pluginStatePayloadBytes: bytes(pluginPayload),
      markProvenancePayloadBytes: bytes(JSON.stringify(this.projection?.marks ?? [])),
      active: this.active,
      error: this.error,
      selection: this.selection,
      source: this.projection?.source,
      reads: this.service.reads,
      calls: this.service.logs,
      created: this.created,
      destroyed: this.destroyed,
      mounted: this.created - this.destroyed,
      pmNodes: nodes,
      pmBytes: bytes(JSON.stringify(this.editor?.getJSON() ?? {})),
      pluginCount: this.editor?.state.plugins.length ?? 0,
      nativeHistoryPlugins:
        this.editor?.state.plugins.filter((p) =>
          String((p as unknown as { key: string }).key).startsWith('history$'),
        ).length ?? 0,
      projectionJsonBytes: bytes(JSON.stringify(this.projection?.content ?? {})),
      editorContentOptionBytes: bytes(JSON.stringify(this.editor?.options.content ?? {})),
      provenanceEntries: (this.projection?.positions.size ?? 0) + (this.projection?.ends.size ?? 0),
      provenancePayloadBytes: bytes(
        JSON.stringify([...(this.projection?.positions ?? []), ...(this.projection?.ends ?? [])]),
      ),
      annotationPayloadBytes: bytes(JSON.stringify(this.service.anchors)),
      rendererJournalPages: 0,
      activeBytes: bytes(this.projection?.source ?? ''),
      cachePages: this.cache.size,
      cacheBytes: [...this.cache.values()].reduce((n, p) => n + bytes(p), 0),
      inFlightBytes: this.inFlightBytes,
      maxInFlightBytes: this.maxInFlightBytes,
      parsedBytes: this.parsedBytes,
      maxParsedBytes: this.maxParsedBytes,
      acceptedRoots: this.acceptedRoots,
      acceptedAppended: this.acceptedAppended,
      ...this.service.stats,
    };
  }
  destroy() {
    this.navigation++;
    this.editor?.destroy();
    if (this.editor) this.destroyed++;
    this.editor = undefined;
    this.projection = undefined;
    this.cache.clear();
  }
}
