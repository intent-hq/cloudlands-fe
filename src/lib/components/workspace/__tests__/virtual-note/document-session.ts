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
  type Splice,
} from './source-journal';
import { SourceProjection } from './source-projection';
import { continuationWindow, CONTINUATION } from './continuation-window';

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
  private windowEnd = 0;
  private continuation = false;
  private selectionGeneration = 0;
  private pointerSelecting = false;
  private continuationQueued = false;
  private pointerDown = () => {
    this.pointerSelecting = true;
  };
  private pointerUp = () => {
    this.pointerSelecting = false;
    this.continueNearEdge();
  };
  private cache = new Map<string, string>();
  private navigation = 0;
  private suppress = false;
  private prevTime = 0;
  private prevComposition: number | undefined;
  private prevRange?: [number, number];
  private pendingFetch?: Promise<void>;
  private pendingNavigation?: (accepted: boolean) => void;
  private rollbackState?: EditorState;
  delayFetch?: () => Promise<void>;
  constructor(
    readonly service: SourceJournal,
    private host: HTMLElement,
    private changed = () => {},
  ) {
    host.addEventListener('pointerdown', this.pointerDown);
    document.addEventListener('pointerup', this.pointerUp);
  }
  private project(source: string, start: number) {
    if (bytes(source) > LIMITS.active)
      throw new Error('Proof projection exceeds experiment budget');
    this.parsedBytes += bytes(source);
    this.maxParsedBytes = Math.max(this.maxParsedBytes, bytes(source));
    return new SourceProjection(source, start);
  }
  private readRange(from: number, to: number) {
    if (to - from > LIMITS.active) throw new Error('Unbounded source range');
    let source = '';
    for (let offset = from; offset < to;) {
      // UTF-16 span capped at 1024 => at most 4096 UTF-8 bytes, without splitting a surrogate.
      let end = Math.min(offset + 1024, to);
      if (end < to && this.service.splitsSurrogate(end)) end--;
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
    return source;
  }
  private readWindow(id: number, position?: number) {
    const bounds = continuationWindow(this.service, id, position);
    const source = this.readRange(bounds.from, bounds.to);
    this.inFlightBytes += bytes(source);
    this.maxInFlightBytes = Math.max(this.maxInFlightBytes, this.inFlightBytes);
    return { ...bounds, source };
  }
  /** A source coordinate identifies a continuation; page edges never enter the source. */
  seek(position: number, restore = true) {
    return this.show(
      Math.min(this.service.locate(position).id, Math.max(0, this.service.count - 2)),
      restore,
      position,
    );
  }
  private continueNearEdge() {
    if (!this.continuation || this.continuationQueued || !this.editor || this.editor.view.composing)
      return;
    const p = this.projection!,
      head = this.selection.head;
    if (head < p.start || head > this.windowEnd) return;
    const first = this.service.start(this.active),
      last = this.service.start(this.active + 1);
    if (!(
      (p.start > first && head < p.start + CONTINUATION.margin) ||
      (this.windowEnd < last && head > this.windowEnd - CONTINUATION.margin)
    ))
      return;
    this.continuationQueued = true;
    queueMicrotask(() => {
      this.continuationQueued = false;
      if (!this.editor || this.editor.view.composing) return;
      void this.show(this.active, true, this.selection.head, true);
    });
  }
  async show(id: number, restore = false, position?: number, preserveView = false) {
    if (this.editor?.view.composing) {
      this.error = 'Composition pins current view';
      this.changed();
      return false;
    }
    const ticket = ++this.navigation;
    const revision = this.service.revision;
    const selectionGeneration = this.selectionGeneration;
    // One shared pending request, with latest navigation winning before any payload is captured.
    if (this.delayFetch) {
      this.pendingNavigation?.(false);
      const ready = new Promise<boolean>((resolve) => {
        this.pendingNavigation = resolve;
      });
      this.pendingFetch ??= this.delayFetch().then(
        () => {
          this.pendingFetch = undefined;
          const resolve = this.pendingNavigation;
          this.pendingNavigation = undefined;
          resolve?.(true);
        },
        (error) => {
          this.pendingFetch = undefined;
          this.error = String(error);
          this.pendingNavigation?.(false);
          this.pendingNavigation = undefined;
        },
      );
      if (!(await ready)) return false;
    }
    if (
      ticket !== this.navigation ||
      revision !== this.service.revision ||
      selectionGeneration !== this.selectionGeneration ||
      (this.pointerSelecting && !preserveView) ||
      this.editor?.view.composing
    ) {
      this.error = 'Stale or composing view pinned';
      this.changed();
      return false;
    }
    const window = this.readWindow(id, position);
    try {
      const next = this.project(window.source, window.from);
      if (preserveView && this.editor) {
        // Keep Chromium's active keyboard or mouse gesture on the same focused view.
        // Only the bounded projection is replaced; durable source/history are untouched.
        const editor = this.editor;
        const before = editor.view.coordsAtPos(editor.state.selection.head).top;
        let scroller = this.host.parentElement;
        while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY))
          scroller = scroller.parentElement;
        this.projection = next;
        this.windowEnd = window.to;
        this.suppress = true;
        try {
          const tr = editor.state.tr.replaceWith(
            0,
            editor.state.doc.content.size,
            editor.schema.nodeFromJSON(next.content).content,
          );
          tr.setSelection(
            TextSelection.create(
              tr.doc,
              next.pmAt(this.selection.anchor, this.selection.affinity),
              next.pmAt(this.selection.head, this.selection.affinity),
            ),
          );
          editor.view.dispatch(tr.setMeta('addToHistory', false));
        } finally {
          this.suppress = false;
        }
        if (scroller)
          scroller.scrollTop += editor.view.coordsAtPos(editor.state.selection.head).top - before;
        this.error = '';
        this.changed();
        return true;
      }
      this.editor?.destroy();
      if (this.editor) this.destroyed++;
      this.active = id;
      this.windowEnd = window.to;
      this.continuation = window.continuation;
      this.projection = next;
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
      const dispatch = this.editor.view.props.dispatchTransaction!;
      this.editor.view.setProps({
        dispatchTransaction: (tr) => {
          this.rollbackState = this.editor!.state;
          try {
            dispatch.call(this.editor!.view, tr);
          } finally {
            this.rollbackState = undefined;
          }
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
    } finally {
      this.inFlightBytes -= bytes(window.source);
    }
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
    const old = {
      projection: this.projection,
      windowEnd: this.windowEnd,
      selection: this.selection,
      prevTime: this.prevTime,
      prevComposition: this.prevComposition,
      prevRange: this.prevRange,
      acceptedRoots: this.acceptedRoots,
      acceptedAppended: this.acceptedAppended,
    };
    try {
      this.service.atomic(() => {
        for (let index = 0; index < transactions.length; index++) {
          const tr = transactions[index];
          if (!tr.docChanged) {
            if (tr.selectionSet) {
              this.selection = this.fromPM(tr.selection);
              this.selectionGeneration++;
            }
            continue;
          }
          let nodes = 0;
          tr.doc.descendants(() => {
            nodes++;
          });
          if (nodes > LIMITS.nodes) throw new Error('Proof projection exceeds node budget');
          if (index) this.acceptedAppended++;
          else this.acceptedRoots++;
          const before = { ...this.selection };
          let adjacent = false;
          tr.mapping.maps[0]?.forEach((from, to) => {
            const start = this.projection!.sourceAt(from),
              end = this.projection!.sourceAt(to);
            if (this.prevRange && start <= this.prevRange[1] && end >= this.prevRange[0])
              adjacent = true;
          });
          const anchorsBefore = structuredClone(this.service.anchors);
          const history =
            tr.getMeta('addToHistory') !== false &&
            transactions[0].getMeta('addToHistory') !== false;
          this.service.beginChanges();
          const oldStart = this.projection!.start;
          for (let n = 0; n < tr.steps.length; n++) {
            for (const splice of this.projection!.translate(tr.steps[n], tr.docs[n])) {
              this.service.stage(splice, history);
              this.windowEnd = mapPoint(this.windowEnd, splice);
              if (!history && this.prevRange)
                this.prevRange = [
                  mapPoint(this.prevRange[0], splice),
                  mapPoint(this.prevRange[1], splice),
                ];
            }
            this.projection = this.project(this.readRange(oldStart, this.windowEnd), oldStart);
          }
          const after = this.fromPM(tr.selection);
          const composition = tr.getMeta('composition');
          const group =
            this.prevTime !== 0 &&
            (index > 0 ||
              (composition !== undefined && composition === this.prevComposition) ||
              (tr.time - this.prevTime <= 500 && !!adjacent));
          if (history)
            this.service.record(
              {
                changes: [],
                before,
                after,
                anchorsBefore,
                anchorsAfter: structuredClone(this.service.anchors),
              },
              group,
            );
          if (history) {
            this.prevRange = undefined;
            for (let m = tr.mapping.maps.length - 1; m >= 0 && !this.prevRange; m--) {
              tr.mapping.maps[m].forEach((_from, _to, from, to) => {
                this.prevRange = [this.projection!.sourceAt(from), this.projection!.sourceAt(to)];
              });
            }
            this.prevTime = tr.time;
            if (composition !== undefined) this.prevComposition = composition;
          }
          this.selection = after;
          this.selectionGeneration++;
          this.cache.clear();
        }
      });
      this.error = '';
      // Only source changes invalidate anchors. Refreshing during a selectionchange can
      // race the browser's next native selection update.
      if (transactions.some((tr) => tr.docChanged)) this.editor?.view.setProps({});
      this.changed();
      this.continueNearEdge();
    } catch (error) {
      Object.assign(this, old);
      if (this.rollbackState) this.editor!.view.updateState(this.rollbackState);
      this.error = String(error);
      this.changed();
    }
  }
  async history(redo = false) {
    const index = redo ? this.service.cursor : this.service.cursor - 1;
    if (index < 0 || index >= this.service.depth) return false;
    const event = this.service.event(index);
    this.service.atomic(() => {
      this.service.bookmark(index, redo ? 'before' : 'after', this.selection);
      for (const change of this.service.changes(index, !redo))
        this.service.apply(
          redo
            ? change
            : { from: change.from, to: change.from + change.insert.length, insert: change.removed },
        );
      this.service.anchors = structuredClone(redo ? event.anchorsAfter : event.anchorsBefore);
      this.service.cursor += redo ? 1 : -1;
    });
    this.selection = { ...(redo ? event.after : event.before), revision: this.service.revision };
    this.prevTime = 0;
    this.cache.clear();
    await this.seek(this.selection.head);
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
    const after = this.service.atomic(() => {
      this.service.beginChanges();
      this.service.stage({ from, to, insert });
      const after: Selection = {
        anchor: from + insert.length,
        head: from + insert.length,
        affinity: 1,
        revision: this.service.revision,
      };
      this.service.record(
        {
          changes: [],
          before,
          after,
          anchorsBefore,
          anchorsAfter: structuredClone(this.service.anchors),
        },
        false,
      );
      return after;
    });
    this.selection = after;
    this.prevTime = 0;
    this.cache.clear();
    await this.seek(from);
  }
  remote(splice: Splice) {
    const oldStart = this.projection!.start;
    this.service.atomic(() => {
      this.service.apply(splice);
      this.service.rebase(splice);
    });
    this.selection = mapSelection(this.selection, splice, this.service.revision);
    this.windowEnd = mapPoint(this.windowEnd, splice);
    if (this.prevRange)
      this.prevRange = [mapPoint(this.prevRange[0], splice), mapPoint(this.prevRange[1], splice)];
    this.cache.clear();
    if (splice.to <= oldStart) {
      const start = mapPoint(oldStart, splice);
      this.projection = this.project(this.readRange(start, this.windowEnd), start);
      this.editor?.view.setProps({});
      this.changed();
    } else void this.seek(this.selection.head);
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
      continuation: this.continuation,
      windowFrom: this.projection?.start,
      windowTo: this.windowEnd,
      continuationMetadataBytes: bytes(
        JSON.stringify({
          from: this.projection?.start,
          to: this.windowEnd,
          region: this.active,
          revision: this.service.revision,
        }),
      ),
      retainedEditorStates: Number(!!this.rollbackState),
      pointerSelecting: this.pointerSelecting,
      pluginStateFields: pluginStates.length,
      pluginStatePayloadBytes: bytes(pluginPayload),
      tokenProvenancePayloadBytes: bytes(JSON.stringify(this.projection?.tokens ?? [])),
      pendingWindowRequests: Number(!!this.pendingFetch),
      pendingNavigationRequests: Number(!!this.pendingNavigation),
      markProvenancePayloadBytes: bytes(JSON.stringify(this.projection?.marks ?? [])),
      active: this.active,
      error: this.error,
      selection: this.selection,
      source: this.projection?.source,
      reads: this.service.reads,
      maxSourceRead: this.service.maxRead,
      // Count duplicated source/text representations explicitly; these are serialized payload
      // counts, not a heap measurement. Mock backing source and oracle live elsewhere.
      sourceReplicaPayloadBytes:
        bytes(this.projection?.source ?? '') +
        [...this.cache.values()].reduce((n, page) => n + bytes(page), 0) +
        this.inFlightBytes +
        (this.projection?.tokens.reduce((n, t) => n + bytes(t.raw) + bytes(t.text), 0) ?? 0) +
        bytes(JSON.stringify(this.projection?.content ?? {})) +
        bytes(JSON.stringify(this.editor?.getJSON() ?? {})) +
        bytes(JSON.stringify(this.editor?.options.content ?? {})),
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
    this.host.removeEventListener('pointerdown', this.pointerDown);
    document.removeEventListener('pointerup', this.pointerUp);
    this.pendingNavigation?.(false);
    this.pendingNavigation = undefined;
    this.editor?.destroy();
    if (this.editor) this.destroyed++;
    this.editor = undefined;
    this.projection = undefined;
    this.cache.clear();
  }
}
