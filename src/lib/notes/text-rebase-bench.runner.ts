/**
 * The text-rebase alignment bench of ONE source tree, run by
 * `vitest.text-rebase-bench.config.ts` (never by `test:unit`: the name is not
 * a test pattern). Each shape of `textRebaseShapes()` is projected to plain
 * text once, by the CURRENT tree's editor (`createEditorConfig`, as
 * `text-rebase.test.ts` projects in production mode), then
 * `createBidirectionalOffsetMapper(plain, markdown)` — imported from
 * `./text-rebase` here, which the bench config redirects into the tree named
 * by `TEXT_REBASE_BENCH_SRC`, `$lib/...` imports and all — is timed under each
 * clock of `BENCH_CLOCKS`, cold and cached. The rows go to `task.meta`; the
 * config's reporter assembles the JSON document. Caveats:
 *
 * - Bare packages (`diff`, `marked`, …) resolve from THIS package's
 *   `node_modules` whichever tree is under test, so two trees are compared on
 *   one dependency set, not on the lockfile of each.
 * - The projection is input, not the thing measured; a tree whose projection
 *   differs from the current one is measured against the current one.
 * - `test:unit`'s forks run with V8 Sparkplug disabled (see `vitest.config.ts`),
 *   inherited here: absolute figures are not the renderer's, the comparison is.
 * - A tree from before `createBidirectionalOffsetMapper` existed (pre-#2740
 *   main) is measured through both directions of its `createOffsetMapper`,
 *   i.e. two alignments, as production derived the pair then. Which of the
 *   two the tree got is its `mapperMode` (`resolveOffsetMapperFactory`),
 *   decided once per tree and put on every row's `task.meta` so the
 *   reporter can emit it as a top-level field of the document.
 * - Under the natural clock `deadlineHit` is read off `performance.now`: the
 *   alignment learns its deadline elapsed only by a read at or past it, so a
 *   diff that gave up on its own — on its edit-length bound (#2824 on), or on
 *   jsdiff's `Date.now` timeout in a tree before it — counts only once a later
 *   read confirms the budget spent. Under the unbounded clock it is `null`.
 *
 * `TEXT_REBASE_BENCH_REPEATS` (default 5) sets the cached sample count and
 * `TEXT_REBASE_BENCH_SHAPES` (comma list) narrows the shapes.
 */
import { afterAll, beforeAll, describe, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { processMarkdownToHTML } from '$lib/utils/markdown-processor';
import { createEditorConfig } from '$lib/utils/editor-config';
import { CommentAnchor } from '$lib/components/tiptap/CommentAnchor';
import { docTextOffsets } from './doc-text-offsets';
import { TEXT_REBASE_SHAPE_NAMES, textRebaseShapes } from './text-rebase-shapes';
import * as textRebase from './text-rebase';
import {
  BENCH_CLOCKS,
  benchShape,
  installClock,
  parseRepeats,
  resolveOffsetMapperFactory,
  selectShapes,
  type BenchRow,
  type BenchSubject,
  type InstalledClock,
  type MapperMode,
} from './text-rebase-bench';

declare module 'vitest' {
  interface TaskMeta {
    textRebaseBench?: BenchRow[];
    textRebaseBenchMapperMode?: MapperMode;
  }
}

const { mode: mapperMode, factory } = resolveOffsetMapperFactory(
  textRebase as Partial<typeof textRebase>,
);

const repeats = parseRepeats(process.env.TEXT_REBASE_BENCH_REPEATS);
const shapeNames = selectShapes(process.env.TEXT_REBASE_BENCH_SHAPES, TEXT_REBASE_SHAPE_NAMES);

async function projectWithEditor(markdown: string): Promise<string> {
  const html = await processMarkdownToHTML(markdown, { preserveAnchors: true });
  const element = document.createElement('div');
  const options = createEditorConfig({
    element,
    content: html,
    editable: true,
    onUpdate: () => {},
    useMarkdown: true,
    enableComments: false,
  });
  options.extensions = [...(options.extensions ?? []), CommentAnchor];
  const editor = new Editor(options);
  try {
    return docTextOffsets(editor.state.doc).text;
  } finally {
    editor.destroy();
  }
}

const subjects = new Map<string, BenchSubject>();

beforeAll(async () => {
  for (const shape of textRebaseShapes()) {
    if (!shapeNames.includes(shape.name)) continue;
    subjects.set(shape.name, { ...shape, plain: await projectWithEditor(shape.markdown) });
  }
});

for (const mode of BENCH_CLOCKS) {
  describe(`${mode} clock`, () => {
    let clock: InstalledClock;
    beforeAll(() => {
      clock = installClock(mode);
    });
    afterAll(() => clock.restore());

    for (const name of shapeNames) {
      it(name, ({ task }) => {
        const subject = subjects.get(name);
        if (!subject) throw new Error(`shape ${name} was not projected`);
        task.meta.textRebaseBenchMapperMode = mapperMode;
        task.meta.textRebaseBench = benchShape(factory, subject, clock, repeats);
      });
    }
  });
}
