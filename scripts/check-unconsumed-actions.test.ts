import { describe, expect, it } from 'vitest';
import { inspectUnconsumedActions } from './check-unconsumed-actions.mjs';

const SLICE = 'src/store/renderer/slices/demo/demo-slice.ts';
const SAGA = 'src/store/renderer/slices/demo/sagas/demo-saga.ts';
const SLICE_IMPORT =
  "import { createAction, createAsyncAction } from '@themislib/themis/utils/store/create-action';";
const SAGA_IMPORT =
  "import { put, take, takeEvery, takeLatest, throttle } from 'typed-redux-saga';";
const ACTIONS_IMPORT = "import { a, b, req } from '../demo-slice';";

const slice = (handlers: string[] = [], creators: string[] = []) => ({
  path: SLICE,
  content: [
    SLICE_IMPORT,
    "import { createReducer } from '@themislib/themis/utils/store/create-reducer';",
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
        slice([], ["export const c = createAction('demo/c');"]),
        {
          path: SAGA,
          content: [
            SAGA_IMPORT,
            "import { a, b, c } from '../demo-slice';",
            'const handled = [a, b];',
            'export function* demoSaga() {',
            "  yield* put(a({ id: 'x' }));",
            '  yield* put(b());',
            '  yield* put(c());',
            '  yield* takeLatest(handled, worker);',
            '  yield* throttle(100, c, worker);',
            '}',
          ].join('\n'),
        },
      ],
      noExceptions,
    );
    expect(result.violations).toEqual([]);
    expect(result.dispatchedCount).toBe(3);
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

// Predicates must enumerate a finite set of types from their own action parameter.
// The unhandled sibling proves that a matching predicate is not a blanket consumer.
describe('inline actionChannel predicates', () => {
  const inspect = (
    predicate: string,
    {
      imports = "import { actionChannel } from 'typed-redux-saga';",
      before = '',
      after = '',
      call = 'actionChannel',
    } = {},
  ) =>
    inspectUnconsumedActions(
      [
        slice([], ["export const c = createAction('demo/c');"]),
        saga(
          [
            "yield* put(a({ id: 'x' }));",
            'yield* put(b());',
            'yield* put(c());',
            before,
            `yield* ${call}(${predicate});`,
            after,
          ],
          { actions: `${ACTIONS_IMPORT}\nimport { c } from '../demo-slice';\n${imports}` },
        ),
      ],
      noExceptions,
    );
  const diagnostic = (name: string, declaration: number, dispatch: number) =>
    `${SLICE}:${declaration}: action ${name} is dispatched but has no reducer case or explicit watcher; dispatched at ${SAGA}:${dispatch}`;
  const allUnhandled = [diagnostic('a', 3, 6), diagnostic('b', 4, 7), diagnostic('c', 5, 8)];

  it.each([
    '(action) => action.type === a.type',
    '(action) => a.type === action.type',
    '(action: Action): boolean => (action.type === a.type)',
    '(action) => { return action.type === a.type; }',
    '(action) => { const current = action; return current.type === a.type; }',
    '(action) => (action.type === a.type) satisfies boolean',
    '(action) => action.type === a.type && true',
    '(action) => action.type === a.type && action.payload !== NaN',
    '(action) => action.type === a.type && NaN !== action.payload',
    '(action) => false || action.type === a.type',
    '(action) => (action.type === b.type && false) || action.type === a.type',
    'function (action) { return action.type === a.type; }',
    '(action) => action.type === "demo/a"',
    '(action) => action.type === a.type && action.payload[0].workspaceId === workspaceId',
    '(action) => action.payload[0] === workspaceId && action.type === a.type',
    '(action) => action.payload[0]["workspaceId"] === workspaceId && action.type === a.type',
    '(action) => typeof action.payload[0] === "object" && action.payload[0] !== null && action.type === a.type',
    '(action) => { const payload = action.payload; const first = payload[0]; const candidate = first as { workspaceId: string }; return candidate.workspaceId === workspaceId && action.type === a.type; }',
    '(action) => { const first = action.payload[0]; const candidate = typeof first === "object" && first !== null ? first as Record<string, unknown> : undefined; return candidate?.workspaceId === workspaceId && action.type === a.type; }',
  ])('credits only the positively matched action: %s', (predicate) => {
    expect(inspect(predicate)).toEqual({
      violations: allUnhandled.slice(1),
      actionCount: 3,
      dispatchedCount: 3,
      exceptionCount: 0,
    });
  });

  it.each([
    '(action) => action.type === a.type || action.type === b.type',
    '(action) => action.payload[0] === workspaceId && (action.type === a.type || action.type === b.type)',
    '(action) => { const first = action.payload[0]; const candidate = typeof first === "object" && first !== null ? first as Record<string, unknown> : undefined; return candidate?.workspaceId === workspaceId && (action.type === a.type || action.type === b.type); }',
  ])('credits a finite returned disjunction: %s', (predicate) => {
    expect(inspect(predicate).violations).toEqual(allUnhandled.slice(2));
  });

  it.each([
    { imports: "import { actionChannel as channel } from 'typed-redux-saga';", call: 'channel' },
    { imports: "import * as effects from 'redux-saga/effects';", call: 'effects.actionChannel' },
  ])('follows effect import provenance: $call', (options) => {
    expect(inspect('(action) => action.type === a.type', options).violations).toEqual(
      allUnhandled.slice(1),
    );
  });

  it.each([
    {
      imports:
        "import { actionChannel } from 'typed-redux-saga'; import { a as matched } from '../demo-slice';",
      creator: 'matched',
    },
    {
      imports:
        "import { actionChannel } from 'typed-redux-saga'; import * as actions from '../demo-slice';",
      creator: 'actions.a',
    },
  ])('follows creator import provenance: $creator', ({ creator, ...options }) => {
    expect(inspect(`(action) => action.type === ${creator}.type`, options).violations).toEqual(
      allUnhandled.slice(1),
    );
  });

  it('keeps async stages separate inside a predicate', () => {
    const result = inspectUnconsumedActions(
      [
        slice([], ["export const req = createAsyncAction('demo/req', 'demo/stages');"]),
        saga(
          [
            'yield* put(req.success());',
            'yield* put(req.failure());',
            'yield* actionChannel((action) => action.type === req.success.type);',
          ],
          { actions: `${ACTIONS_IMPORT} import { actionChannel } from 'typed-redux-saga';` },
        ),
      ],
      noExceptions,
    );
    expect(result.violations).toEqual([
      `${SLICE}:5: action req.failure is dispatched but has no reducer case or explicit watcher; dispatched at ${SAGA}:5`,
    ]);
  });

  it('does not treat a shadowed NaN identifier as the intrinsic constant', () => {
    expect(
      inspect('(action) => action.type === a.type && action.payload === NaN', {
        before: 'const NaN = expectedPayload;',
      }).violations,
    ).toEqual(allUnhandled.slice(1));
  });

  it('bounds expansion of repeated disjunctions', () => {
    const predicate = `(action) => ${Array(65).fill('action.type === a.type').join(' || ')}`;
    expect(inspect(predicate).violations).toEqual(allUnhandled);
  });

  it.each([
    '(action) => action.type !== a.type',
    '(action) => !(action.type === a.type)',
    '(action) => action.type.startsWith("demo/")',
    '(action) => action.type === getType(a)',
    '(action) => action.type === a["type"]',
    '(action) => action["type"] === a.type',
    '(action) => other.type === a.type',
    '(action) => action.payload.type === a.type',
    '(action) => action.type === a.type || enabled',
    '(action) => action.type === a.type || true',
    '(action) => action.type === a.type || other.type === b.type',
    '(action) => action.type === a.type && false',
    '(action) => action.type === a.type && (enabled && false) === true',
    '(action) => action.type === a.type && true === (enabled && false)',
    '(action) => { const guard = enabled && false; return action.type === a.type && guard === true; }',
    '(action) => action.type === a.type && typeof (enabled && false) === "object"',
    '(action) => action.type === a.type && action["type"] !== "demo/a"',
    '(action) => { const current = action; return action.type === a.type && current["type"] !== "demo/a"; }',
    '(action) => action.type === a.type && other["type"] === "demo/b"',
    '(action) => action.type === a.type && null',
    '(action) => action.type === a.type && undefined',
    '(action) => action.type === a.type && NaN',
    '(action) => action.type === a.type && action.payload === NaN',
    '(action) => action.type === a.type && NaN === action.payload',
    '(action) => { const invalid = NaN; return action.type === a.type && action.payload === invalid; }',
    '(action) => action.type === a.type && void 0',
    '(action) => action.type === a.type && (enabled ? false : false)',
    '(action) => { const guard = enabled ? false : false; return action.type === a.type && guard; }',
    '(action) => { const first = candidate; const candidate = action.payload[0]; return action.type === a.type; }',
    '(action) => { const first = first; return action.type === a.type; }',
    '(action) => { const first = candidate, candidate = action.payload[0]; return action.type === a.type; }',
    '(action) => action.type === a.type && 1 === 2',
    '(action) => action.type === a.type && false !== false',
    '(action) => action.type === a.type && workspaceId !== workspaceId',
    '(action) => action.type === a.type && 0',
    '(action) => action.type === a.type && ""',
    '(action) => action.type === a.type && !true',
    '(action) => action.type === a.type && !(1 === 1)',
    '(action) => action.type === a.type && !typeof action',
    '(action) => action.type === a.type && enabled === false && enabled',
    '(action) => action.type === a.type && action.payload === null && action.payload',
    '(action) => action.type === a.type && !action',
    '(action) => action.type === a.type && action.type === b.type',
    '(action) => action.type === a.type && enabled && !enabled',
    '(action) => action.type === a.type && action.payload[0] === workspaceId && action.payload[0] !== workspaceId',
    '(action) => action.type === a.type && typeof action.payload[0] === "object" && typeof action.payload[0] === "string"',
    '(action) => { action.type === a.type; return false; }',
    '(action) => { const match = action.type === a.type; return false; }',
    '(action) => { return false; return action.type === a.type; }',
    '(action) => { if (enabled) return action.type === a.type; return false; }',
    '(action) => { function nested(action) { return action.type === a.type; } return false; }',
    '(action) => (() => action.type === a.type)()',
    '(action) => { action = other; return action.type === a.type; }',
    '(action) => { action.type = a.type; return action.type === a.type; }',
    '(action) => { let first = action.payload[0]; return action.type === a.type; }',
    '(action) => { const first = mutate(action); return action.type === a.type; }',
    '(action) => { const { type } = action; return type === a.type; }',
    '(action) => { const candidate = other; return candidate.type === a.type; }',
    '(action) => { const candidate = action; candidate.type = b.type; return action.type === a.type; }',
    '(action) => { const a = other; return action.type === a.type; }',
    '(action, a) => action.type === a.type',
    '(action = other) => action.type === a.type',
    'async (action) => action.type === a.type',
    'function* (action) { return action.type === a.type; }',
    '(action) => action.type === a.type && mutate(action)',
  ])('does not infer a consumer from unsupported or impossible filters: %s', (predicate) => {
    expect(inspect(predicate).violations).toEqual(allUnhandled);
  });

  it.each([
    { before: 'const a = other;' },
    { before: 'function* nested(a) {', after: '}' },
    { before: 'function* nested(actionChannel) {', after: '}' },
    { before: 'function actionChannel() {}' },
    { before: 'try {} catch (a) {', after: '}' },
    { before: '{ let a = other;', after: '}' },
    { before: 'const actionChannel = unrelated;' },
    { imports: "import { actionChannel } from 'foreign-effects';" },
    {
      imports: "import * as effects from 'redux-saga/effects';",
      before: 'const effects = unrelated;',
      call: 'effects.actionChannel',
    },
    { before: 'const predicate = (action) => action.type === a.type;', predicate: 'predicate' },
    { before: '', call: 'takeEvery' },
  ])(
    'rejects shadowed/foreign effects, creators and named/watcher predicates: %j',
    ({ predicate = '(action) => action.type === a.type', ...options }) => {
      expect(inspect(predicate, options).violations).toEqual(allUnhandled);
    },
  );
});
