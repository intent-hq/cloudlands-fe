import { describe, expect, it } from 'vitest';
import { inspectUnconsumedActions } from './check-unconsumed-actions.mjs';

const SLICE = 'src/store/renderer/slices/demo/demo-slice.ts';
const SAGA = 'src/store/renderer/slices/demo/sagas/demo-saga.ts';
const SLICE_IMPORT =
  "import { createAction, createAsyncAction } from '@augmentcode/themis/utils/store/create-action';";
const SAGA_IMPORT =
  "import { put, take, takeEvery, takeLatest, throttle } from 'typed-redux-saga';";
const ACTIONS_IMPORT = "import { a, b, req } from '../demo-slice';";

const slice = (handlers: string[] = [], creators: string[] = []) => ({
  path: SLICE,
  content: [
    SLICE_IMPORT,
    "import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';",
    "export const a = createAction<{ id: string }>('demo/a');",
    "export const b = createAction('demo/b');",
    ...creators,
    `export const reducer = createReducer({})${handlers.map((h) => `.with(${h})`).join('')};`,
  ].join('\n'),
});

const saga = (body: string[], { path = SAGA, actions = ACTIONS_IMPORT } = {}) => ({
  path,
  content: [SAGA_IMPORT, actions, 'export function* demoSaga() {', ...body, '}'].join('\n'),
});

const noExceptions = { exceptions: [] };

describe('unconsumed action guard', () => {
  it('accepts a put handled by a reducer case', () => {
    const result = inspectUnconsumedActions(
      [slice(['a, (state) => state']), saga(["  yield* put(a({ id: 'x' }));"])],
      noExceptions,
    );
    expect(result.violations).toEqual([]);
    expect(result.dispatchedCount).toBe(1);
  });

  it('accepts a put handled by a takeEvery watcher', () => {
    const result = inspectUnconsumedActions(
      [slice(), saga(["  yield* put(a({ id: 'x' }));", '  yield* takeEvery(a, worker);'])],
      noExceptions,
    );
    expect(result.violations).toEqual([]);
  });

  it('accepts puts handled through a local array takeLatest and a throttle watcher', () => {
    const result = inspectUnconsumedActions(
      [
        slice(),
        {
          path: SAGA,
          content: [
            SAGA_IMPORT,
            ACTIONS_IMPORT,
            'const handled = [a, b];',
            'export function* demoSaga() {',
            "  yield* put(a({ id: 'x' }));",
            '  yield* put(b());',
            '  yield* takeLatest(handled, worker);',
            '  yield* throttle(100, b, worker);',
            '}',
          ].join('\n'),
        },
      ],
      noExceptions,
    );
    expect(result.violations).toEqual([]);
    expect(result.dispatchedCount).toBe(2);
  });

  it('rejects a put consumed only by a predicate take, naming the declaration and dispatch', () => {
    const result = inspectUnconsumedActions(
      [
        slice(),
        saga([
          "  yield* put(a({ id: 'x' }));",
          "  yield* take((action) => action.type.startsWith('demo/'));",
        ]),
      ],
      noExceptions,
    );
    expect(result.violations).toEqual([
      expect.stringMatching(new RegExp(`^${SLICE}:3: action a .*${SAGA}:4$`)),
    ]);
  });

  it('rejects a put routed through a local wrapper, listing the wrapper call site', () => {
    const result = inspectUnconsumedActions(
      [
        slice(),
        {
          path: SAGA,
          content: [
            SAGA_IMPORT,
            ACTIONS_IMPORT,
            'function* effect(fence: unknown, action: unknown) {',
            '  yield* put(action);',
            '}',
            'export function* demoSaga() {',
            "  const id = 'x';",
            '  yield* effect(fence, a({ id }));',
            '}',
          ].join('\n'),
        },
      ],
      noExceptions,
    );
    expect(result.violations).toEqual([expect.stringContaining(`dispatched at ${SAGA}:8`)]);
  });

  it('rejects a store.dispatch from a Svelte script block at its source line', () => {
    const result = inspectUnconsumedActions(
      [
        slice(),
        {
          path: 'src/features/demo/Demo.svelte',
          content: [
            '<div class="demo">header</div>',
            '<script lang="ts">',
            "  import { store } from '$store/renderer/store';",
            "  import { a } from '$store/renderer/slices/demo/demo-slice';",
            "  store.dispatch(a({ id: 'x' }));",
            '</script>',
            '<p>footer</p>',
          ].join('\n'),
        },
      ],
      noExceptions,
    );
    expect(result.violations).toEqual([
      expect.stringContaining('dispatched at src/features/demo/Demo.svelte:5'),
    ]);
  });

  it('accepts an unhandled put covered by an injected exception', () => {
    const result = inspectUnconsumedActions([slice(), saga(["  yield* put(a({ id: 'x' }));"])], {
      exceptions: [{ pattern: /demo-slice\.ts#a$/, rationale: 'fixture' }],
    });
    expect(result.violations).toEqual([]);
    expect(result.exceptionCount).toBe(1);
  });

  it('ignores an action that is declared but never dispatched', () => {
    const result = inspectUnconsumedActions(
      [slice(), saga(['  yield* takeEvery(b, worker);'])],
      noExceptions,
    );
    expect(result.violations).toEqual([]);
    expect(result.actionCount).toBe(2);
    expect(result.dispatchedCount).toBe(0);
  });

  it('tracks createAsyncAction stages independently', () => {
    const result = inspectUnconsumedActions(
      [
        slice(
          ['req.success, (state) => state'],
          ["export const req = createAsyncAction<string, string>('demo/req', 'demo/reqStages');"],
        ),
        saga(["  yield* put(req.success('r'));", "  yield* put(req.failure(new Error('e')));"]),
      ],
      noExceptions,
    );
    expect(result.violations).toEqual([
      expect.stringMatching(new RegExp(`^${SLICE}:5: action req\\.failure .*${SAGA}:5$`)),
    ]);
  });

  it('rejects a stale exception entry, naming its pattern', () => {
    const pattern = /demo-slice\.ts#retired$/;
    const result = inspectUnconsumedActions([slice(), saga(['  yield* takeEvery(a, worker);'])], {
      exceptions: [{ pattern, rationale: 'fixture' }],
    });
    expect(result.violations).toEqual([expect.stringContaining(`stale exception ${pattern}`)]);
    expect(result.exceptionCount).toBe(0);
  });

  it.each([
    'src/store/renderer/slices/demo/sagas/demo-saga.spec.ts',
    'src/store/renderer/slices/demo/sagas/demo-saga.test.ts',
    'src/store/renderer/slices/demo/sagas/__tests__/demo-saga.ts',
    'src/store/renderer/slices/demo/__mocks__/demo-saga.ts',
  ])('does not count a watcher in test-only source %s as a consumer', (testPath) => {
    const result = inspectUnconsumedActions(
      [
        slice(),
        saga(["  yield* put(a({ id: 'x' }));"]),
        saga(['  yield* takeEvery(a, worker);'], { path: testPath }),
      ],
      noExceptions,
    );
    expect(result.violations).toEqual([
      expect.stringMatching(new RegExp(`^${SLICE}:3: action a `)),
    ]);
  });

  it('applies an anchored #name$ exception to that action only', () => {
    const files = [
      slice([], ["export const openAll = createAction('demo/openAll');"]),
      saga(["  yield* put(a({ id: 'x' }));", '  yield* put(openAll());'], {
        actions: "import { a, openAll } from '../demo-slice';",
      }),
    ];
    const anchored = inspectUnconsumedActions(files, {
      exceptions: [{ pattern: /demo-slice\.ts#a$/, rationale: 'fixture' }],
    });
    expect(anchored.exceptionCount).toBe(1);
    expect(anchored.violations).toEqual([
      expect.stringMatching(new RegExp(`^${SLICE}:5: action openAll `)),
    ]);

    const wholeSlice = inspectUnconsumedActions(files, {
      exceptions: [{ pattern: /demo-slice\.ts#/, rationale: 'fixture' }],
    });
    expect(wholeSlice.exceptionCount).toBe(2);
    expect(wholeSlice.violations).toEqual([]);
  });
});
