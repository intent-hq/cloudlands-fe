import type { Workspace } from '$shared/types';
import { Editor, Extension } from '@tiptap/core';
import { AllSelection, TextSelection, Plugin, type Transaction } from '@tiptap/pm/state';
import { CommentAnchor } from '$lib/components/tiptap/CommentAnchor';
import { createEditorConfig } from '$lib/utils/editor-config';
import { measureNoteProjection } from './note-view-cost';
import { measureNoteDom } from './note-dom-cost';
import { projectNoteWindow } from './note-window-projection';
import type { SourceProjection } from './projection/source-projection';
import type { NoteWindow } from './note-window-reader';
import type { NoteResourceCost } from './note-resource-ledger';

export interface NoteSourceSelection {
  anchor: number;
  head: number;
  anchorAffinity: -1 | 1;
  headAffinity: -1 | 1;
}
export interface NoteViewEditing {
  /** Document-session owner accepts bounded native transactions and owns chronological
   * history/source writes. A disposable view must never create its own undo history. */
  accept(transaction: Transaction, projection: SourceProjection): boolean;
  undo(): void;
  redo(): void;
}
export interface NoteWindowViewOptions {
  workspace?: Workspace;
  seek(position: number): void;
  selectionChanged(selection: NoteSourceSelection): void;
  fullOperation(kind: 'copy' | 'search' | 'selectAll', selection: NoteSourceSelection): void;
  editing?: NoteViewEditing;
  changed?(): void;
}
/** One disposable native view. No source backing, page cache, persistence or per-view history.
 * Geometry, Editor/DOM and in-progress composition are its only runtime ownership. */
export interface NoteReadingSurface {
  /** Shared renderer admission policy supplied by the application rollout owner. */
  resourceLimits: NoteResourceCost;
  /** Supplied by the document-operation owner only after rollout prerequisites pass.
   * Never use visible editor text as the implementation of this operation. */
  copyDocument(): Promise<void>;
  selectionChanged(selection: NoteSourceSelection): void;
  fullOperation: NoteWindowViewOptions['fullOperation'];
  editing?: NoteViewEditing;
  ready?(view: NoteWindowView): void;
}
export class NoteWindowView {
  editor?: Editor;
  projection?: SourceProjection;
  window?: NoteWindow;
  private pending?: NoteWindow;
  private pins = new Set<string | symbol>();
  private readonly compositionPin = Symbol('native composition');
  private disposed = false;
  private applying = false;
  private requested = -1;
  private rate = 0.35;
  private frame = 0;
  private domFrame = 0;
  private programmatic = false;
  private selection: NoteSourceSelection = {
    anchor: 0,
    head: 0,
    anchorAffinity: 1,
    headAffinity: 1,
  };
  private anchor?: { source: number; offset: number };
  private navigationAnchor?: { source: number; offset: number };
  readonly host = document.createElement('div');
  private readonly before = document.createElement('div');
  private readonly after = document.createElement('div');
  readonly cost = {
    createdViews: 0,
    destroyedViews: 0,
    mountedViews: 0,
    mountedNodes: 0,
    mountedDomNodes: 0,
    domPayloadBytes: 0,
    domPeakBytes: 0,
    domMeasurementNodes: 0,
    sourceBytes: 0,
    contextBytes: 0,
    pendingBytes: 0,
    derivedBytes: 0,
    projectionPeakBytes: 0,
    windowAssemblyPeakBytes: 0,
  };
  private observer: ResizeObserver;
  private domObserver: MutationObserver;
  constructor(
    readonly scroller: HTMLElement,
    private readonly options: NoteWindowViewOptions,
  ) {
    this.before.setAttribute('aria-hidden', 'true');
    this.after.setAttribute('aria-hidden', 'true');
    this.host.className = 'note-window-native';
    scroller.append(this.before, this.host, this.after);
    scroller.style.overflowAnchor = 'none';
    scroller.addEventListener('scroll', this.scroll, { passive: true });
    scroller.addEventListener('wheel', this.physicalIntent, { passive: true });
    scroller.addEventListener('pointerdown', this.physicalIntent);
    scroller.addEventListener('keydown', this.keydown, true);
    scroller.addEventListener('copy', this.copy, true);
    this.host.addEventListener('compositionstart', this.compositionStart);
    this.host.addEventListener('compositionend', this.compositionEnd);
    this.observer = new ResizeObserver(() => this.measure());
    this.observer.observe(this.host);
    this.domObserver = new MutationObserver(this.scheduleDomMeasurement);
    this.observeDom();
  }
  private observeDom(root: Node = this.host) {
    this.domObserver.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
  }
  private scheduleDomMeasurement = () => {
    if (this.disposed || this.domFrame) return;
    this.domFrame = requestAnimationFrame(() => {
      this.domFrame = 0;
      this.measureDom();
    });
  };
  private measureDom() {
    if (this.disposed) return;
    const measured = measureNoteDom(this.host);
    this.cost.mountedDomNodes = measured.nodes;
    this.cost.domPayloadBytes = measured.payloadBytes;
    this.cost.domPeakBytes = Math.max(this.cost.domPeakBytes, measured.payloadBytes);
    this.cost.domMeasurementNodes += measured.nodes;
    // Releasing old roots prevents detached primitive output from staying owned.
    this.domObserver.disconnect();
    this.observeDom();
    for (const root of measured.shadowRoots) this.observeDom(root);
  }
  updateEditing(editing?: NoteViewEditing) {
    const changed = !!editing !== !!this.options.editing;
    this.options.editing = editing;
    if (changed) this.editor?.setEditable(!!editing, false);
  }
  getSelection(): NoteSourceSelection {
    return { ...this.selection };
  }
  private command(kind: 'copy' | 'search' | 'selectAll') {
    if (kind === 'selectAll' && this.window) {
      this.selection = {
        anchor: 0,
        head: this.window.sourceLength,
        anchorAffinity: 1,
        headAffinity: 1,
      };
      this.options.selectionChanged(this.getSelection());
      if (this.editor) {
        this.applying = true;
        try {
          this.editor.view.dispatch(
            this.editor.state.tr
              .setSelection(new AllSelection(this.editor.state.doc))
              .setMeta('addToHistory', false),
          );
        } finally {
          this.applying = false;
        }
      }
    }
    this.options.fullOperation(kind, this.getSelection());
  }
  private physicalIntent = () => {
    // A user scroll wins over a pending resize correction and over programmatic
    // scroll-event suppression. The next scroll event captures the new anchor.
    this.anchor = undefined;
    this.programmatic = false;
  };
  private keydown = (event: KeyboardEvent) => {
    if (['PageDown', 'PageUp', 'Home', 'End', 'ArrowDown', 'ArrowUp'].includes(event.key))
      this.physicalIntent();
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.isComposing) return;
    const key = event.key.toLowerCase();
    if (key === 'a' || key === 'f') {
      event.preventDefault();
      event.stopPropagation();
      this.command(key === 'a' ? 'selectAll' : 'search');
    }
  };
  private copy = (event: Event) => {
    const w = this.window,
      s = this.selection;
    if (
      w &&
      (s.anchor < w.range.start ||
        s.anchor > w.range.end ||
        s.head < w.range.start ||
        s.head > w.range.end)
    ) {
      event.preventDefault();
      event.stopPropagation();
      this.command('copy');
    }
  };
  forceMount(reason: 'focus' | 'selection' | 'composition') {
    const owner = Symbol(reason);
    this.pin(owner);
    return () => this.release(owner);
  }
  private compositionStart = () => {
    this.pins.add(this.compositionPin);
  };
  private compositionEnd = () => {
    // ProseMirror's final composition transaction runs before the next animation frame.
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.release(this.compositionPin);
    });
  };
  pin(reason: string | symbol) {
    this.pins.add(reason);
  }
  release(reason: string | symbol) {
    if (!this.pins.delete(reason)) return;
    if (!this.pins.size && this.pending) {
      const pending = this.pending;
      this.pending = undefined;
      this.show(pending);
    }
  }
  reveal(position: number) {
    this.navigationAnchor = { source: position, offset: this.scroller.clientHeight / 3 };
    if (this.window && position >= this.window.range.start && position <= this.window.range.end) {
      this.anchor = this.navigationAnchor;
      this.navigationAnchor = undefined;
      this.restoreAnchor();
    } else this.options.seek(Math.max(0, position - 1024));
  }
  setSelection(selection: NoteSourceSelection) {
    this.selection = { ...selection };
    const w = this.window,
      p = this.projection,
      e = this.editor;
    if (!w || !p || !e || selection.head < w.range.start || selection.head > w.range.end) {
      this.navigationAnchor = { source: selection.head, offset: this.scroller.clientHeight / 3 };
      this.options.seek(Math.max(0, selection.head - 1024));
      return;
    }
    this.applying = true;
    try {
      e.view.dispatch(
        e.state.tr
          .setSelection(
            TextSelection.create(
              e.state.doc,
              p.pmAt(
                Math.max(w.range.start, Math.min(w.range.end, selection.anchor)),
                selection.anchorAffinity,
              ),
              p.pmAt(selection.head, selection.headAffinity),
            ),
          )
          .setMeta('addToHistory', false),
      );
    } finally {
      this.applying = false;
    }
  }
  private captureAnchor() {
    const e = this.editor,
      p = this.projection;
    if (!e || !p) return undefined;
    const rect = this.scroller.getBoundingClientRect();
    const hit = e.view.posAtCoords({ left: rect.left + 24, top: rect.top + 4 });
    if (!hit) return undefined;
    try {
      return { source: p.sourceAt(hit.pos), offset: e.view.coordsAtPos(hit.pos).top - rect.top };
    } catch {
      return undefined;
    }
  }
  show(window: NoteWindow) {
    if (this.disposed) return false;
    if (this.window === window) return true;
    if (this.pins.size || this.editor?.view.composing) {
      this.pending = window;
      this.cost.pendingBytes = window.cost.sourceBytes + window.cost.contextBytes;
      return false;
    }
    const anchor = this.navigationAnchor ?? this.captureAnchor();
    // Build/admit first; unsupported context must leave the existing view intact.
    const projection = projectNoteWindow(window);
    const admitted = measureNoteProjection(projection);
    this.cost.projectionPeakBytes = Math.max(
      this.cost.projectionPeakBytes,
      this.cost.derivedBytes + admitted.derivedBytes,
    );
    this.cost.windowAssemblyPeakBytes = Math.max(
      this.cost.windowAssemblyPeakBytes,
      window.cost.assemblyPeakBytes,
    );
    const config = createEditorConfig({
      element: this.host,
      content: '',
      workspace: this.options.workspace,
      editable: !!this.options.editing,
      useMarkdown: true,
      enableComments: false,
      enableMentions: true,
      enableNotePrimitives: true,
      onUpdate: () => {},
    });
    const extensions = (config.extensions ?? []).map((e) =>
      e.name === 'starterKit' ? e.configure({ undoRedo: false }) : e,
    );
    const relay = Extension.create({
      name: 'noteDocumentCommands',
      priority: 2000,
      addProseMirrorPlugins: () => [
        new Plugin({
          filterTransaction: (tr) =>
            !tr.docChanged || !!this.options.editing?.accept(tr, projection),
        }),
      ],
      addKeyboardShortcuts: () => ({
        'Mod-z': () => {
          this.options.editing?.undo();
          return true;
        },
        'Mod-Shift-z': () => {
          this.options.editing?.redo();
          return true;
        },
        'Mod-a': () => {
          this.command('selectAll');
          return true;
        },
        'Mod-f': () => {
          this.command('search');
          return true;
        },
      }),
    });
    this.destroyEditor();
    this.projection = projection;
    this.window = window;
    this.pending = undefined;
    this.cost.pendingBytes = 0;
    this.editor = new Editor({
      ...config,
      content: projection.content,
      extensions: [...extensions, CommentAnchor, relay],
      editorProps: {
        ...config.editorProps,
        handleDOMEvents: {
          ...config.editorProps?.handleDOMEvents,
          copy: (_view, event) => {
            if (
              this.selection.anchor < window.range.start ||
              this.selection.anchor > window.range.end ||
              this.selection.head < window.range.start ||
              this.selection.head > window.range.end
            ) {
              event.preventDefault();
              this.command('copy');
              return true;
            }
            return false;
          },
        },
        handleKeyDown: (_view, event) => {
          if (
            event.key === 'ArrowDown' ||
            event.key === 'ArrowRight' ||
            event.key === 'ArrowUp' ||
            event.key === 'ArrowLeft'
          ) {
            const direction = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1;
            const edge = direction > 0 ? window.range.end : window.range.start;
            if (
              Math.abs(this.selection.head - edge) < 2 &&
              edge > 0 &&
              edge < window.sourceLength
            ) {
              const head = Math.min(
                window.sourceLength,
                Math.max(0, this.selection.head + direction),
              );
              this.selection = {
                ...this.selection,
                anchor: event.shiftKey ? this.selection.anchor : head,
                head,
              };
              this.options.selectionChanged(this.selection);
              this.options.seek(head);
              event.preventDefault();
              return true;
            }
          }
          return false;
        },
      },
      onTransaction: ({ transaction }) => {
        if (this.applying) return;
        if (transaction.selectionSet && this.projection) {
          try {
            const anchor = this.projection.sourceAt(transaction.selection.anchor),
              head = this.projection.sourceAt(transaction.selection.head);
            this.selection = { anchor, head, anchorAffinity: 1, headAffinity: 1 };
            this.options.selectionChanged(this.selection);
          } catch {
            /* Structural atoms report their bounded source range through navigation. */
          }
        }
      },
    });
    const editor = this.editor;
    this.cost.createdViews++;
    this.cost.mountedViews = 1;
    let nodes = 0;
    editor.state.doc.descendants(() => {
      nodes++;
    });
    this.cost.mountedNodes = nodes;
    this.cost.sourceBytes = window.cost.sourceBytes;
    this.cost.contextBytes = window.cost.contextBytes;
    this.cost.derivedBytes = admitted.derivedBytes;
    this.measureDom();
    this.requested = -1;
    this.layout();
    if (anchor && anchor.source >= window.range.start && anchor.source <= window.range.end) {
      this.anchor = anchor;
      this.navigationAnchor = undefined;
      this.restoreAnchor();
    }
    if (this.selection.head >= window.range.start && this.selection.head <= window.range.end) {
      this.setSelection(this.selection);
    }
    this.options.changed?.();
    return true;
  }
  private layout() {
    const w = this.window;
    if (!w) return;
    // A compressed document extent stays within browser layout coordinate limits.
    const rate = Math.min(this.rate, 8_000_000 / Math.max(1, w.sourceLength));
    this.before.style.height = `${w.range.start * rate}px`;
    this.after.style.height = `${(w.sourceLength - w.range.end) * rate}px`;
  }
  private restoreAnchor() {
    if (!this.anchor || !this.editor || !this.projection) return;
    const at = this.projection.pmAt(this.anchor.source);
    const delta =
      this.editor.view.coordsAtPos(at).top -
      this.scroller.getBoundingClientRect().top -
      this.anchor.offset;
    if (Math.abs(delta) > 0.5) {
      this.programmatic = true;
      this.scroller.scrollTop += delta;
    }
  }
  private measure() {
    if (!this.window || this.disposed) return;
    this.scheduleDomMeasurement();
    const anchor = this.anchor ?? this.captureAnchor();
    const height = this.host.getBoundingClientRect().height;
    if (height > 0) {
      this.rate = height / Math.max(1, this.window.range.end - this.window.range.start);
      this.layout();
    }
    this.anchor = anchor;
    this.restoreAnchor();
  }
  private scroll = () => {
    if (this.programmatic) {
      this.programmatic = false;
      return;
    }
    const w = this.window;
    if (!w) return;
    const viewport = this.scroller.getBoundingClientRect(),
      rect = this.host.getBoundingClientRect();
    this.anchor = this.captureAnchor();
    let target: number | undefined;
    if (rect.bottom < viewport.top || rect.top > viewport.bottom) {
      const rate = Math.min(this.rate, 8_000_000 / Math.max(1, w.sourceLength));
      target = Math.floor(this.scroller.scrollTop / rate);
    } else if (rect.bottom < viewport.bottom + 120 && w.range.end < w.sourceLength) {
      target = Math.max(w.range.start, w.range.end - 1024);
    } else if (rect.top > viewport.top - 120 && w.range.start > 0) {
      target = Math.max(0, w.range.start - 3072);
    }
    if (target !== undefined) {
      target = Math.max(0, Math.min(w.sourceLength - 1, target));
      if (target !== this.requested) {
        this.requested = target;
        this.options.seek(target);
      }
    }
  };
  private destroyEditor() {
    if (this.editor) {
      this.editor.destroy();
      this.editor = undefined;
      this.cost.destroyedViews++;
      this.cost.mountedViews = 0;
    }
  }
  destroy() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    cancelAnimationFrame(this.domFrame);
    this.domObserver.disconnect();
    this.scroller.removeEventListener('scroll', this.scroll);
    this.scroller.removeEventListener('wheel', this.physicalIntent);
    this.scroller.removeEventListener('pointerdown', this.physicalIntent);
    this.scroller.removeEventListener('keydown', this.keydown, true);
    this.scroller.removeEventListener('copy', this.copy, true);
    this.host.removeEventListener('compositionstart', this.compositionStart);
    this.host.removeEventListener('compositionend', this.compositionEnd);
    this.destroyEditor();
    this.projection = undefined;
    this.window = undefined;
    this.pending = undefined;
    this.pins.clear();
    this.before.remove();
    this.host.remove();
    this.after.remove();
    this.cost.mountedNodes = 0;
    this.cost.mountedDomNodes = 0;
    this.cost.domPayloadBytes = 0;
    this.cost.sourceBytes = 0;
    this.cost.contextBytes = 0;
    this.cost.pendingBytes = 0;
    this.cost.derivedBytes = 0;
  }
}
