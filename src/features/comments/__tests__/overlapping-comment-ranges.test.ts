/**
 * Overlapping comment ranges (monorepo: daemon now accepts overlapping adds)
 *
 * Two comments whose ranges overlap produce interleaved marker pairs in the
 * note body (a:start … b:start … a:end … b:end) — legal content post-daemon
 * change. These tests pin FE behavior:
 * - per-id anchor lookup and decoration ranges (including one range fully
 *   inside another),
 * - click routing to the right comment,
 * - scanAnchorHealth / orphan check tolerate interleaved pairs,
 * - markdown → editor round-trip preserves interleaved anchors in order.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from 'vitest';

vi.mock('$store/renderer/store', async () => {
  const { createStoreMockModule } = await import('$store/renderer/utils/test-helpers/store-mock');
  const { commentsReducer, initialState } = await vi.importActual<typeof import('$store/renderer/slices/comments/comments-slice')>(
    '$store/renderer/slices/comments/comments-slice'
  );
  let state = { comments: initialState };
  const readable = <T>(getter: () => T) => ({
    subscribe: (listener: (value: T) => void) => {
      listener(getter());
      return () => {};
    },
  });

  const mockStore = {
    dispatch: (action: unknown) => {
      state = { comments: commentsReducer(state.comments, action as never) };
      return action;
    },
    get state() {
      return state;
    },
    createSelector: (selectorFunc: (state: any, ...args: any[]) => any) => Object.assign(
      (...args: any[]) => readable(() => selectorFunc(mockStore.state, ...args)),
      {
        select: selectorFunc,
        effect: (...args: any[]) => selectorFunc(mockStore.state, ...args),
        withStore: (storeSource: { state?: unknown }) =>
          (...args: any[]) => readable(() => selectorFunc(storeSource.state ?? mockStore.state, ...args)),
      },
    ),
  };

  return createStoreMockModule(mockStore);
});

import { Editor } from '@tiptap/core';
import type { EditorView } from '@tiptap/pm/view';
import { CommentManagerV2 } from '../comment-manager-v2';
import { store as appStore } from '$store/renderer/store';
import { loadCommentsAction } from '$store/renderer/slices/comments/comments-slice';
import { selectCommentById } from '$store/renderer/slices/comments/comments-selectors';
import { findCommentAnchors } from '$lib/components/tiptap/CommentAnchor';
import { createCommentDecorationsPlugin } from '$lib/components/tiptap/CommentDecorations';
import {
  processMarkdownToHTML,
  processHTMLToMarkdown,
} from '$lib/utils/markdown-processor';
import { scanForProblematicAnchors } from '../main/markdown-anchor-recovery';
import {
  createTestEditor,
  destroyTestEditor,
  createTestComment,
  clearCommentsStore,
} from './test-utils';
import type { CommentV2 } from '../comment-types-v2';

const TEXT = 'alpha beta gamma delta';

/** Insert one anchor node at a fixed position (descending order avoids shifts). */
function insertAnchorAt(
  editor: Editor,
  commentId: string,
  type: 'start' | 'end',
  pos: number,
): void {
  editor.commands.insertContentAt(pos, {
    type: 'commentAnchor',
    attrs: { id: `${commentId}:${type}`, type, commentId },
  });
}

/**
 * Interleaved pair over "alpha beta gamma delta" (text starts at pos 1):
 * a covers "alpha beta gamma", b covers "beta gamma delta", so the doc order
 * is a:start … b:start … a:end … b:end.
 */
function insertInterleavedAnchors(editor: Editor, aId: string, bId: string): void {
  insertAnchorAt(editor, bId, 'end', 23);
  insertAnchorAt(editor, aId, 'end', 17);
  insertAnchorAt(editor, bId, 'start', 7);
  insertAnchorAt(editor, aId, 'start', 1);
}

/**
 * Nested pair: a covers all of "alpha beta gamma delta", b covers
 * "beta gamma" — b's range lies fully inside a's.
 */
function insertNestedAnchors(editor: Editor, aId: string, bId: string): void {
  insertAnchorAt(editor, aId, 'end', 23);
  insertAnchorAt(editor, bId, 'end', 17);
  insertAnchorAt(editor, bId, 'start', 7);
  insertAnchorAt(editor, aId, 'start', 1);
}

describe('Overlapping comment ranges', () => {
  let editor: Editor;

  beforeEach(() => {
    editor = createTestEditor(TEXT);
    clearCommentsStore();
  });

  afterEach(() => {
    destroyTestEditor(editor);
  });

  describe('per-id anchor lookup (findCommentAnchors)', () => {
    it('resolves each range of an interleaved pair independently', () => {
      insertInterleavedAnchors(editor, 'cmt-a', 'cmt-b');

      const a = findCommentAnchors(editor.state.doc, 'cmt-a');
      const b = findCommentAnchors(editor.state.doc, 'cmt-b');

      expect(a.start).toBeDefined();
      expect(a.end).toBeDefined();
      expect(b.start).toBeDefined();
      expect(b.end).toBeDefined();

      // Interleaved order: a:start < b:start < a:end < b:end
      expect(a.start!).toBeLessThan(b.start!);
      expect(b.start!).toBeLessThan(a.end!);
      expect(a.end!).toBeLessThan(b.end!);

      expect(editor.state.doc.textBetween(a.start!, a.end!)).toBe('alpha beta gamma');
      expect(editor.state.doc.textBetween(b.start!, b.end!)).toBe('beta gamma delta');
    });

    it('resolves a range fully nested inside another independently', () => {
      insertNestedAnchors(editor, 'cmt-a', 'cmt-b');

      const a = findCommentAnchors(editor.state.doc, 'cmt-a');
      const b = findCommentAnchors(editor.state.doc, 'cmt-b');

      // Nested order: a:start < b:start < b:end < a:end
      expect(a.start!).toBeLessThan(b.start!);
      expect(b.start!).toBeLessThan(b.end!);
      expect(b.end!).toBeLessThan(a.end!);

      expect(editor.state.doc.textBetween(a.start!, a.end!)).toBe('alpha beta gamma delta');
      expect(editor.state.doc.textBetween(b.start!, b.end!)).toBe('beta gamma');
    });
  });

  describe('stacked inline decorations', () => {
    function setupDecorations(aId: string, bId: string, onCommentClick?: (id: string) => void) {
      const comments: CommentV2[] = [
        createTestComment({ id: aId }),
        createTestComment({ id: bId }),
      ];
      const plugin = createCommentDecorationsPlugin({
        getComments: () => comments,
        onCommentClick,
      });
      editor.registerPlugin(plugin);
      return plugin;
    }

    /** Concatenated visible text of all decoration spans for one comment id. */
    function decoratedText(commentId: string): string {
      const spans = editor.view.dom.querySelectorAll(
        `.comment-highlight[data-comment-id="${commentId}"]`,
      );
      let text = '';
      spans.forEach((span) => {
        // Skip spans nested inside another span for the SAME id so overlap
        // segments are not double-counted.
        const parent = span.parentElement?.closest(
          `.comment-highlight[data-comment-id="${commentId}"]`,
        );
        if (!parent) text += span.textContent ?? '';
      });
      return text;
    }

    it('renders both highlights of an interleaved pair with per-id ranges', () => {
      insertInterleavedAnchors(editor, 'cmt-a', 'cmt-b');
      setupDecorations('cmt-a', 'cmt-b');

      expect(decoratedText('cmt-a')).toBe('alpha beta gamma');
      expect(decoratedText('cmt-b')).toBe('beta gamma delta');

      // The overlap region carries both decorations (stacked spans).
      const overlap = editor.view.dom.querySelector(
        '.comment-highlight[data-comment-id="cmt-a"] .comment-highlight[data-comment-id="cmt-b"],' +
          ' .comment-highlight[data-comment-id="cmt-b"] .comment-highlight[data-comment-id="cmt-a"]',
      );
      expect(overlap).not.toBeNull();
    });

    it('renders a fully nested range inside the outer range', () => {
      insertNestedAnchors(editor, 'cmt-a', 'cmt-b');
      setupDecorations('cmt-a', 'cmt-b');

      expect(decoratedText('cmt-a')).toBe('alpha beta gamma delta');
      expect(decoratedText('cmt-b')).toBe('beta gamma');
    });

    it('routes clicks on each highlight to the right comment', () => {
      insertInterleavedAnchors(editor, 'cmt-a', 'cmt-b');
      const onCommentClick = vi.fn();
      const plugin = setupDecorations('cmt-a', 'cmt-b', onCommentClick);
      const handleClick = plugin.props.handleClick! as (
        view: EditorView,
        pos: number,
        event: MouseEvent,
      ) => boolean;

      // Click a's unique region (the span containing "alpha").
      const aSpans = Array.from(
        editor.view.dom.querySelectorAll('.comment-highlight[data-comment-id="cmt-a"]'),
      );
      const aUnique = aSpans.find((s) => (s.textContent ?? '').includes('alpha'));
      expect(aUnique).toBeDefined();
      expect(handleClick(editor.view, 2, { target: aUnique } as unknown as MouseEvent)).toBe(true);
      expect(onCommentClick).toHaveBeenLastCalledWith('cmt-a');

      // Click b's unique region (the span containing "delta").
      const bSpans = Array.from(
        editor.view.dom.querySelectorAll('.comment-highlight[data-comment-id="cmt-b"]'),
      );
      const bUnique = bSpans.find((s) => (s.textContent ?? '').includes('delta'));
      expect(bUnique).toBeDefined();
      expect(handleClick(editor.view, 20, { target: bUnique } as unknown as MouseEvent)).toBe(true);
      expect(onCommentClick).toHaveBeenLastCalledWith('cmt-b');
    });
  });

  describe('anchor health with interleaved pairs', () => {
    let manager: CommentManagerV2;

    beforeEach(async () => {
      manager = new CommentManagerV2('test-workspace', 'test-note');
      await manager.initialize(editor);
    });

    it('scanAnchorHealth keeps both comments of an interleaved pair healthy', async () => {
      insertInterleavedAnchors(editor, 'cmt-a', 'cmt-b');
      appStore.dispatch(
        loadCommentsAction([
          createTestComment({ id: 'cmt-a', anchorText: 'alpha beta gamma' }),
          createTestComment({ id: 'cmt-b', anchorText: 'beta gamma delta' }),
        ]),
      );

      await manager.scanAnchorHealth();

      expect(selectCommentById.select(appStore.state, 'cmt-a')?.isOrphaned).toBe(false);
      expect(selectCommentById.select(appStore.state, 'cmt-b')?.isOrphaned).toBe(false);

      // Neither pair's anchors were cleaned up as "broken".
      const a = findCommentAnchors(editor.state.doc, 'cmt-a');
      const b = findCommentAnchors(editor.state.doc, 'cmt-b');
      expect(a.start).toBeDefined();
      expect(a.end).toBeDefined();
      expect(b.start).toBeDefined();
      expect(b.end).toBeDefined();
    });

    it('scanAnchorHealth keeps a fully nested pair healthy', async () => {
      insertNestedAnchors(editor, 'cmt-a', 'cmt-b');
      appStore.dispatch(
        loadCommentsAction([
          createTestComment({ id: 'cmt-a', anchorText: 'alpha beta gamma delta' }),
          createTestComment({ id: 'cmt-b', anchorText: 'beta gamma' }),
        ]),
      );

      await manager.scanAnchorHealth();

      expect(selectCommentById.select(appStore.state, 'cmt-a')?.isOrphaned).toBe(false);
      expect(selectCommentById.select(appStore.state, 'cmt-b')?.isOrphaned).toBe(false);
    });

    it('orphan check does not flag either comment of an interleaved pair', async () => {
      insertInterleavedAnchors(editor, 'cmt-a', 'cmt-b');
      appStore.dispatch(
        loadCommentsAction([
          createTestComment({ id: 'cmt-a', anchorText: 'alpha beta gamma' }),
          createTestComment({ id: 'cmt-b', anchorText: 'beta gamma delta' }),
        ]),
      );

      const orphaned = (
        manager as unknown as { performOrphanCheck: () => CommentV2[] }
      ).performOrphanCheck();

      expect(orphaned).toEqual([]);
    });
  });

  describe('markdown round-trip with interleaved marker pairs', () => {
    const INTERLEAVED_MD =
      'alpha <!--anchor:cmt-a:start-->beta <!--anchor:cmt-b:start-->gamma' +
      '<!--anchor:cmt-a:end--> delta<!--anchor:cmt-b:end--> omega';
    const NESTED_MD =
      'alpha <!--anchor:cmt-a:start-->beta <!--anchor:cmt-b:start-->gamma' +
      '<!--anchor:cmt-b:end--> delta<!--anchor:cmt-a:end--> omega';

    function markerOrder(text: string, markers: string[]): number[] {
      return markers.map((marker) => text.indexOf(marker));
    }

    const INTERLEAVED_MARKERS = [
      '<!--anchor:cmt-a:start-->',
      '<!--anchor:cmt-b:start-->',
      '<!--anchor:cmt-a:end-->',
      '<!--anchor:cmt-b:end-->',
    ];
    const NESTED_MARKERS = [
      '<!--anchor:cmt-a:start-->',
      '<!--anchor:cmt-b:start-->',
      '<!--anchor:cmt-b:end-->',
      '<!--anchor:cmt-a:end-->',
    ];

    function expectAscending(positions: number[]): void {
      for (const pos of positions) {
        expect(pos).toBeGreaterThanOrEqual(0);
      }
      for (let i = 1; i < positions.length; i++) {
        expect(positions[i]).toBeGreaterThan(positions[i - 1]);
      }
    }

    it('markdown → HTML preserves interleaved anchor spans in order', async () => {
      const html = await processMarkdownToHTML(INTERLEAVED_MD, { preserveAnchors: true });
      expectAscending(
        markerOrder(html, [
          'data-anchor-id="cmt-a:start"',
          'data-anchor-id="cmt-b:start"',
          'data-anchor-id="cmt-a:end"',
          'data-anchor-id="cmt-b:end"',
        ]),
      );
    });

    it('markdown → editor → markdown preserves interleaved anchors in order', async () => {
      const html = await processMarkdownToHTML(INTERLEAVED_MD, { preserveAnchors: true });
      editor.commands.setContent(html);

      const a = findCommentAnchors(editor.state.doc, 'cmt-a');
      const b = findCommentAnchors(editor.state.doc, 'cmt-b');
      expect(a.start!).toBeLessThan(b.start!);
      expect(b.start!).toBeLessThan(a.end!);
      expect(a.end!).toBeLessThan(b.end!);

      const roundTripped = processHTMLToMarkdown(editor.getHTML(), { preserveAnchors: true });
      expectAscending(markerOrder(roundTripped, INTERLEAVED_MARKERS));
    });

    it('markdown → editor → markdown preserves a nested pair in order', async () => {
      const html = await processMarkdownToHTML(NESTED_MD, { preserveAnchors: true });
      editor.commands.setContent(html);

      const a = findCommentAnchors(editor.state.doc, 'cmt-a');
      const b = findCommentAnchors(editor.state.doc, 'cmt-b');
      expect(a.start!).toBeLessThan(b.start!);
      expect(b.end!).toBeLessThan(a.end!);

      const roundTripped = processHTMLToMarkdown(editor.getHTML(), { preserveAnchors: true });
      expectAscending(markerOrder(roundTripped, NESTED_MARKERS));
    });

    it('scanForProblematicAnchors does not flag interleaved pairs', () => {
      expect(scanForProblematicAnchors(INTERLEAVED_MD, ['cmt-a', 'cmt-b'])).toEqual([]);
      expect(scanForProblematicAnchors(NESTED_MD, ['cmt-a', 'cmt-b'])).toEqual([]);
    });
  });
});
