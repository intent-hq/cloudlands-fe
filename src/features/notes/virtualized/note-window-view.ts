import type { NoteViewCoordinates } from './note-view-coordinates';
import type { Workspace } from '$shared/types';
import { Editor, Extension } from '@tiptap/core';
import { AllSelection, TextSelection, EditorState } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import { CommentAnchor } from '$lib/components/tiptap/CommentAnchor';
import { createEditorConfig } from '$lib/utils/editor-config';
import { NoteNativeLifetime } from './note-native-lifetime';
import { logger } from '$lib/utils/client-logger';
import { measureNoteProjection } from './note-view-cost';
import { measureNoteDom } from './note-dom-cost';
import { projectNoteWindow } from './note-window-projection';
import type { SourceProjection } from './projection/source-projection';
import type { NoteWindow } from './note-window-reader';
import type { NoteResourceCost } from './note-resource-ledger';
import { createNoteTransactionRelay, type NoteTransactionOwner } from './note-transaction-relay';

import type { NoteSourceSelection } from './note-source-selection';
export type { NoteSourceSelection } from './note-source-selection';

export interface NoteViewEditing {
  /** Resolve a current document-owned authority for this mounted window. Binding is
   * pure; an unsupported or stale window remains read-only. */
  bind(
    window: NoteWindow,
    projection: SourceProjection,
    doc: PMNode,
  ): NoteTransactionOwner | undefined;
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
  failed?(): void;
  /** Retain the actual admitted DATA graph until this view releases its reference. */
  retainWindow?(window: NoteWindow): () => void;
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
  private committedProjection?: SourceProjection;
  private committedCoordinates?: NoteViewCoordinates;
  private transactionRelay?: ReturnType<typeof createNoteTransactionRelay>;
  get projection() {
    if (this.transactionRelay?.busy && this.editor)
      return this.transactionRelay.projectionAt(this.editor.state) ?? this.committedProjection;
    return this.committedProjection;
  }
  private get coordinates(): NoteViewCoordinates | undefined {
    if (this.transactionRelay?.busy && this.editor) {
      const provisional = this.transactionRelay.coordinatesAt(this.editor.state);
      if (provisional) return provisional;
    }
    if (this.committedCoordinates) return this.committedCoordinates;
    const window = this.window;
    return (
      window && {
        start: window.range.start,
        end: window.range.end,
        length: window.sourceLength,
        toBase: (position: number) => position,
      }
    );
  }
  private seekCurrent(position: number, affinity: -1 | 1 = 1) {
    const coordinates = this.coordinates;
    if (coordinates)
      this.options.seek(
        coordinates.toBase(Math.max(0, Math.min(coordinates.length, position)), affinity),
      );
    else this.options.seek(Math.max(0, position));
  }
  window?: NoteWindow;
  private pending?: NoteWindow;
  private currentLease?: () => void;
  private lifetime?: NoteNativeLifetime;
  private bindEditing?: (editing: NoteViewEditing | undefined) => boolean;
  private pendingLease?: () => void;
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
    this.host.style.position = 'relative';
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
    if (this.transactionRelay?.defer('owner', () => this.updateEditing(editing))) return;
    const changed = editing !== this.options.editing;
    this.options.editing = editing;
    if (changed) this.editor?.setEditable(this.bindEditing?.(editing) ?? false, false);
  }
  getSelection(): NoteSourceSelection {
    return { ...this.selection };
  }
  private command(kind: 'copy' | 'search' | 'selectAll') {
    if (kind === 'selectAll' && this.coordinates) {
      this.selection = {
        anchor: 0,
        head: this.coordinates.length,
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
    if (this.transactionRelay?.busy) {
      event.preventDefault();
      return;
    }
    const w = this.coordinates,
      s = this.selection;
    if (w && (s.anchor < w.start || s.anchor > w.end || s.head < w.start || s.head > w.end)) {
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
      this.show(pending);
    }
  }
  reveal(position: number) {
    this.navigationAnchor = { source: position, offset: this.scroller.clientHeight / 3 };
    if (
      this.coordinates &&
      position >= this.coordinates.start &&
      position <= this.coordinates.end
    ) {
      this.anchor = this.navigationAnchor;
      this.navigationAnchor = undefined;
      this.restoreAnchor();
    } else this.seekCurrent(Math.max(0, position - 1024));
  }
  setSelection(selection: NoteSourceSelection) {
    if (this.transactionRelay?.defer('selection', () => this.setSelection(selection))) return;
    this.selection = { ...selection };
    const w = this.coordinates,
      p = this.projection,
      e = this.editor;
    if (!w || !p || !e || selection.head < w.start || selection.head > w.end) {
      this.navigationAnchor = { source: selection.head, offset: this.scroller.clientHeight / 3 };
      this.seekCurrent(Math.max(0, selection.head - 1024), selection.headAffinity);
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
                Math.max(w.start, Math.min(w.end, selection.anchor)),
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
    if (this.transactionRelay?.busy) {
      if (this.pending !== window) {
        const lease = this.options.retainWindow?.(window);
        this.pendingLease?.();
        this.pending = window;
        this.pendingLease = lease;
        this.cost.pendingBytes = window.cost.sourceBytes + window.cost.contextBytes;
      }
      this.transactionRelay.defer('window', () => {
        if (this.pending) this.show(this.pending);
      });
      return false;
    }
    if (this.window === window) {
      this.pending = undefined;
      this.pendingLease?.();
      this.pendingLease = undefined;
      return true;
    }
    if (this.pins.size || this.editor?.view.composing) {
      if (this.pending === window) return false;
      const lease = this.options.retainWindow?.(window);
      this.pendingLease?.();
      this.pendingLease = lease;
      this.pending = window;
      this.cost.pendingBytes = window.cost.sourceBytes + window.cost.contextBytes;
      return false;
    }
    const lease = this.pending === window ? this.pendingLease : this.options.retainWindow?.(window);
    if (this.pending !== window) this.pendingLease?.();
    this.pending = undefined;
    this.pendingLease = undefined;
    const lifetime = new NoteNativeLifetime();
    let candidate: Editor | undefined;
    let candidateHost: HTMLDivElement | undefined;
    let published = false;
    try {
      const anchor = this.navigationAnchor ?? this.captureAnchor();
      // Build/admit first; unsupported context must leave the existing view intact.
      const projection = projectNoteWindow(window);
      let admitted = measureNoteProjection(projection);
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
      let boundEditing = this.options.editing;
      let editOwner: NoteTransactionOwner | undefined;
      let currentProjection = projection;
      let currentCoordinates: NoteViewCoordinates | undefined;
      const transactions = createNoteTransactionRelay(() =>
        this.editor === candidate && this.options.editing === boundEditing ? editOwner : undefined,
      );
      const retireFailedView = () => {
        if (this.editor !== candidate) return;
        this.destroyEditor();
        this.pending = undefined;
        this.pendingLease?.();
        this.pendingLease = undefined;
        this.cost.pendingBytes = 0;
        this.options.failed?.();
      };
      const relay = Extension.create({
        name: 'noteDocumentCommands',
        priority: 2000,
        addProseMirrorPlugins: () => [transactions.plugin],
        dispatchTransaction({ transaction, next }) {
          try {
            transactions.dispatch(transaction, next, this.editor);
          } catch (error) {
            try {
              retireFailedView();
            } catch (cleanup) {
              throw new AggregateError([error, cleanup], 'Native note view retirement failed', {
                cause: error,
              });
            }
            throw error;
          }
        },
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
      candidateHost = document.createElement('div');
      candidateHost.style.cssText =
        'position:absolute;visibility:hidden;inset:0 auto auto 0;width:100%';
      this.host.append(candidateHost);
      candidate = new Editor({
        ...config,
        element: null,
        content: projection.content,
        extensions: lifetime.extensions([...extensions, CommentAnchor, relay]),
        editorProps: {
          ...config.editorProps,
          handleDOMEvents: {
            ...config.editorProps?.handleDOMEvents,
            copy: (_view, event) => {
              if (transactions.busy) {
                event.preventDefault();
                return true;
              }
              const coordinates = this.coordinates;
              if (
                coordinates &&
                (this.selection.anchor < coordinates.start ||
                  this.selection.anchor > coordinates.end ||
                  this.selection.head < coordinates.start ||
                  this.selection.head > coordinates.end)
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
              const coordinates = this.coordinates;
              if (!coordinates) return false;
              const edge = direction > 0 ? coordinates.end : coordinates.start;
              if (
                Math.abs(this.selection.head - edge) < 2 &&
                edge > 0 &&
                edge < coordinates.length
              ) {
                const head = Math.min(
                  coordinates.length,
                  Math.max(0, this.selection.head + direction),
                );
                this.selection = {
                  ...this.selection,
                  anchor: event.shiftKey ? this.selection.anchor : head,
                  head,
                };
                this.options.selectionChanged(this.selection);
                this.seekCurrent(head, direction);
                event.preventDefault();
                return true;
              }
            }
            return false;
          },
        },
        onTransaction: ({ transaction, appendedTransactions }) => {
          if (!candidate || this.applying || this.editor !== candidate) return;
          const chain = [transaction, ...appendedTransactions];
          if (chain.some((step) => step.docChanged)) {
            const accepted = transactions.adopt(chain, this.editor.state);
            if (!accepted) {
              // A replaced owner may not adopt a stale native result.
              editOwner = undefined;
              this.editor.setEditable(false, false);
              return;
            }
            currentProjection = accepted.projection;
            this.committedProjection = accepted.projection;
            currentCoordinates = accepted.coordinates;
            this.committedCoordinates = accepted.coordinates;
            this.layout();
            this.cost.projectionPeakBytes = Math.max(
              this.cost.projectionPeakBytes,
              this.cost.derivedBytes + accepted.cost.derivedBytes,
            );
            this.cost.derivedBytes = accepted.cost.derivedBytes;
            let nodes = 0;
            this.editor.state.doc.descendants(() => {
              nodes++;
            });
            this.cost.mountedNodes = nodes;
          }
          if (chain.some((step) => step.selectionSet || step.docChanged) && this.projection) {
            try {
              const selection = this.editor.state.selection;
              const anchor = this.projection.sourceAt(selection.anchor),
                head = this.projection.sourceAt(selection.head);
              this.selection = { anchor, head, anchorAffinity: 1, headAffinity: 1 };
              this.options.selectionChanged(this.selection);
            } catch {
              /* Structural atoms report their bounded source range through navigation. */
            }
          }
        },
      });
      editOwner = boundEditing?.bind(window, projection, candidate.state.doc);
      if (editOwner) {
        const initial = editOwner.initial;
        if (
          !editOwner.current() ||
          initial.doc.type.schema !== candidate.schema ||
          !initial.doc.eq(candidate.schema.nodeFromJSON(initial.projection.content))
        )
          // i18n-ignore (internal validation; the view displays a localized error)
          throw new Error('Invalid initial note edit authority');
        admitted = measureNoteProjection(initial.projection);
        this.cost.projectionPeakBytes = Math.max(
          this.cost.projectionPeakBytes,
          this.cost.derivedBytes + admitted.derivedBytes,
        );
        // The editor is still unmounted. Install the materialized dirty document
        // and its exact map together, without a synthetic edit or history entry.
        candidate.view.updateState(
          EditorState.create({ schema: candidate.schema, doc: initial.doc }),
        );
        currentProjection = initial.projection;
        currentCoordinates = initial.coordinates;
      }
      candidate.setEditable(!!editOwner, false);
      candidate.mount(candidateHost);
      this.destroyEditor();
      this.host.replaceChildren(candidateHost);
      candidateHost.removeAttribute('style');
      this.committedProjection = currentProjection;
      this.committedCoordinates = currentCoordinates;
      this.window = window;
      this.editor = candidate;
      this.transactionRelay = transactions;
      this.bindEditing = (editing) => {
        boundEditing = editing;
        editOwner = editing?.bind(window, currentProjection, editor.state.doc);
        if (editOwner && !editOwner.initial.doc.eq(editor.state.doc)) editOwner = undefined;
        if (editOwner) {
          currentCoordinates = editOwner.initial.coordinates;
          this.committedCoordinates = currentCoordinates;
        }
        return !!editOwner;
      };
      this.currentLease = lease;
      this.lifetime = lifetime;
      this.cost.pendingBytes = 0;
      published = true;
      const editor = candidate;
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
      const coordinates = this.coordinates;
      if (
        coordinates &&
        anchor &&
        anchor.source >= coordinates.start &&
        anchor.source <= coordinates.end
      ) {
        this.anchor = anchor;
        this.navigationAnchor = undefined;
        this.restoreAnchor();
      }
      if (
        coordinates &&
        this.selection.head >= coordinates.start &&
        this.selection.head <= coordinates.end
      ) {
        this.setSelection(this.selection);
      }
      this.options.changed?.();
      return true;
    } catch (error) {
      if (!published) {
        void lifetime
          .dispose(
            () => candidate?.destroy(),
            () => lease?.(),
          )
          .catch((cleanupError) =>
            logger.error('Failed to dispose candidate note view', cleanupError),
          );
        candidateHost?.remove();
      }
      throw error;
    }
  }
  private layout() {
    const w = this.coordinates;
    if (!w) return;
    // A compressed document extent stays within browser layout coordinate limits.
    const rate = Math.min(this.rate, 8_000_000 / Math.max(1, w.length));
    this.before.style.height = `${w.start * rate}px`;
    this.after.style.height = `${(w.length - w.end) * rate}px`;
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
    const coordinates = this.coordinates;
    if (!coordinates || this.disposed) return;
    this.scheduleDomMeasurement();
    const anchor = this.anchor ?? this.captureAnchor();
    const height = this.host.getBoundingClientRect().height;
    if (height > 0) {
      this.rate = height / Math.max(1, coordinates.end - coordinates.start);
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
    const w = this.coordinates;
    if (!w) return;
    const viewport = this.scroller.getBoundingClientRect(),
      rect = this.host.getBoundingClientRect();
    this.anchor = this.captureAnchor();
    let target: number | undefined;
    if (rect.bottom < viewport.top || rect.top > viewport.bottom) {
      const rate = Math.min(this.rate, 8_000_000 / Math.max(1, w.length));
      target = Math.floor(this.scroller.scrollTop / rate);
    } else if (rect.bottom < viewport.bottom + 120 && w.end < w.length) {
      target = Math.max(w.start, w.end - 1024);
    } else if (rect.top > viewport.top - 120 && w.start > 0) {
      target = Math.max(0, w.start - 3072);
    }
    if (target !== undefined) {
      target = Math.max(0, Math.min(w.length - 1, target));
      if (target !== this.requested) {
        this.requested = target;
        this.seekCurrent(target, target < w.start ? -1 : 1);
      }
    }
  };
  private destroyEditor() {
    const editor = this.editor,
      lifetime = this.lifetime,
      lease = this.currentLease;
    this.editor = undefined;
    this.bindEditing = undefined;
    this.lifetime = undefined;
    this.currentLease = undefined;
    this.committedProjection = undefined;
    this.committedCoordinates = undefined;
    this.transactionRelay = undefined;
    this.window = undefined;
    if (lifetime) {
      void lifetime
        .dispose(
          () => editor?.destroy(),
          () => lease?.(),
        )
        .catch((error) => logger.error('Failed to dispose native note view', error));
    } else {
      editor?.destroy();
      lease?.();
    }
    if (editor) {
      this.cost.destroyedViews++;
      this.cost.mountedViews = 0;
    }
  }
  destroy() {
    if (this.transactionRelay?.defer('destroy', () => this.destroy())) return;
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
    this.committedProjection = undefined;
    this.committedCoordinates = undefined;
    this.window = undefined;
    this.pending = undefined;
    this.pendingLease?.();
    this.pendingLease = undefined;
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
