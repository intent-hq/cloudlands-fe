import { Editor, Extension } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { createEditorConfig } from '$lib/utils/editor-config';
import { processHTMLToMarkdown, processMarkdownToHTML } from '$lib/utils/markdown-processor';
import { docTextOffsets } from '$lib/notes/doc-text-offsets';
import { createOffsetMapper } from '$lib/notes/text-rebase';
import {
  BoundedNoteService,
  bytes,
  MAX_REGION_BYTES,
  MAX_RETAINED_REGIONS,
  type Annotation,
  type Mutation,
} from './bounded-note-service';

interface Draft {
  editor: Editor;
  revision: number;
  dirty: boolean;
  changes: number;
  state?: EditorState;
  pending?: Mutation;
  annotationKey: PluginKey<DecorationSet>;
}

/**
 * Isolated experiment, deliberately NOT imported by the app. One editable
 * syntax-complete region is mounted; up to four region states own drafts and
 * history independently of their views. Transport pages are not editor roots.
 * Region-edge selection and oversized syntax nodes remain feasibility gaps.
 */
export class EditingProof {
  readonly drafts = new Map<number, Draft>();
  active = -1;
  error = '';
  parsedBytes = 0;
  maxParsedBytes = 0;
  serializedBytes = 0;
  private operation = 0;
  private navigation = 0;
  private destroyed = false;

  constructor(
    readonly service: BoundedNoteService,
    private host: HTMLElement,
    private changed: () => void,
  ) {}

  get current() {
    return this.drafts.get(this.active);
  }

  async show(id: number): Promise<boolean> {
    if (this.destroyed) return false;
    if (id === this.active) return true;
    if (this.current?.editor.view.composing) {
      this.error = 'Composition pins the current region';
      this.changed();
      return false;
    }
    const generation = ++this.navigation;
    let draft = this.drafts.get(id);
    if (!draft && this.drafts.size >= MAX_RETAINED_REGIONS) {
      // Never silently discard drafts OR history. Production needs a durable
      // journal and explicit history horizon instead of this experiment's stop.
      this.error = 'Retained history capacity reached';
      this.changed();
      return false;
    }
    this.error = '';
    if (!draft) {
      let source = '';
      let cursor = 0;
      let revision: number | undefined;
      do {
        const page = this.service.read(id, cursor, revision);
        revision = page.revision;
        source += page.source;
        if (bytes(source) > MAX_REGION_BYTES) throw new Error('Region budget exceeded');
        if (page.next === null) break;
        cursor = page.next;
      } while (true);
      const annotations = this.service.annotations(id, revision, 0, source.length, 8);
      this.parsedBytes += bytes(source);
      this.maxParsedBytes = Math.max(this.maxParsedBytes, bytes(source));
      const html = await processMarkdownToHTML(source);
      // Parsing may yield while the user navigates or starts composition.
      if (generation !== this.navigation || this.destroyed) return false;
      if (this.current?.editor.view.composing) return false;
      const key = new PluginKey<DecorationSet>(`bounded-annotations-${id}`);
      const reportCapacity = () => {
        this.error = 'Edit journal or document capacity reached';
        this.changed();
      };
      const mappedAnnotations = Extension.create({
        name: 'boundedAnnotations',
        addProseMirrorPlugins() {
          return [
            new Plugin<DecorationSet>({
              key,
              state: {
                init: (_, state) => {
                  const offsets = docTextOffsets(state.doc);
                  const map = createOffsetMapper(source, offsets.text);
                  return DecorationSet.create(
                    state.doc,
                    annotations.items.map((entry: Annotation) =>
                      Decoration.inline(
                        offsets.posOfOffset(map(entry.from)),
                        offsets.posOfOffset(map(entry.to)),
                        {
                          nodeName: 'span',
                          [`data-proof-${entry.kind}`]: entry.id,
                        },
                        { id: entry.id },
                      ),
                    ),
                  );
                },
                apply: (tr, decorations) => decorations.map(tr.mapping, tr.doc),
              },
              props: { decorations: (state) => key.getState(state) },
              filterTransaction: (tr) => {
                if (!tr.docChanged) return true;
                let nodes = 0;
                tr.doc.descendants(() => {
                  nodes += 1;
                });
                // A finite edit journal is a separate budget from mounted DOM.
                const allowed =
                  bytes(tr.doc.textContent) <= MAX_REGION_BYTES &&
                  bytes(JSON.stringify(tr.doc.toJSON())) <= 32768 &&
                  nodes <= 128 &&
                  (draft?.changes ?? 0) < 64;
                if (!allowed) {
                  reportCapacity();
                }
                return allowed;
              },
            }),
          ];
        },
      });
      const config = createEditorConfig({
        element: this.host,
        content: html,
        editable: true,
        useMarkdown: true,
        enableMentions: false,
        enableComments: false,
        onUpdate: () => {},
      });
      this.detach();
      const editor = new Editor({
        ...config,
        extensions: [...config.extensions, mappedAnnotations],
        // Avoid the production callback's HTML serialization per keystroke.
        onUpdate: () => {
          if (draft) {
            draft.dirty = true;
            draft.changes += 1;
            draft.pending = undefined;
          }
          this.changed();
        },
        onSelectionUpdate: () => this.changed(),
      });
      draft = { editor, revision, dirty: false, changes: 0, annotationKey: key };
      this.drafts.set(id, draft);
    } else {
      this.detach();
      draft.editor.mount(this.host);
      // mount recreates extension plugins. Restore the exact state so local
      // plugin keys, mapped decorations and history survive view destruction.
      if (draft.state) draft.editor.view.updateState(draft.state);
    }
    this.active = id;
    draft.editor.view.focus();
    this.changed();
    return true;
  }

  private detach() {
    if (!this.current) return;
    this.current.state = this.current.editor.state;
    this.current.editor.unmount();
  }

  save() {
    const draft = this.current;
    if (!draft || !draft.dirty) return;
    if (!draft.pending) {
      const source = processHTMLToMarkdown(draft.editor.getHTML());
      this.serializedBytes += bytes(source);
      draft.pending = {
        id: this.active,
        expectedRevision: draft.revision,
        operationId: `proof-${++this.operation}`,
        source,
      };
    }
    try {
      draft.revision = this.service.write(draft.pending);
      draft.dirty = false;
      draft.pending = undefined;
      this.error = '';
    } catch (error) {
      this.error = String(error);
    }
    this.changed();
  }

  snapshot() {
    const current = this.current;
    return {
      active: this.active,
      error: this.error,
      retained: this.drafts.size,
      dirty: [...this.drafts].filter(([, draft]) => draft.dirty).map(([id]) => id),
      selection: current?.editor.state.selection.toJSON(),
      annotations: current?.annotationKey
        .getState(current.editor.state)
        ?.find()
        .map((d) => ({
          id: d.spec.id,
          from: d.from,
          to: d.to,
          text: current.editor.state.doc.textBetween(d.from, d.to, '\n'),
        })),
      parsedBytes: this.parsedBytes,
      maxParsedBytes: this.maxParsedBytes,
      serializedBytes: this.serializedBytes,
      calls: this.service.calls,
    };
  }

  destroy() {
    this.destroyed = true;
    this.navigation += 1;
    for (const draft of this.drafts.values()) draft.editor.destroy();
    this.drafts.clear();
  }
}
