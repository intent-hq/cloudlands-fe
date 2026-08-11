import { describe, expect, it } from 'vitest';
import { inspectSagaWatcherOwnership } from './check-saga-watcher-ownership.mjs';

const root = (entries: string[], imports: string[] = []) => ({
  path: 'src/store/renderer/sagas.ts',
  content: `${imports.join('\n')}\nexport const sagas = [${entries.join(', ')}] as const;`,
});

describe('saga watcher ownership guard', () => {
  it('allows native watchers, state waits, payload buffers, subscriptions, and snapshots', () => {
    const source = [
      "import type { Task, EventChannel, Channel } from 'redux-saga';",
      "import { call, take, takeEvery, takeLatest } from 'typed-redux-saga';",
      "import { load, start, stop } from '../slice';",
      'type Subscription = { channel: EventChannel<string>; task: Task };',
      'function* sameSemantics(action: unknown) {',
      '  const supported = [start.type, stop.type];',
      '  yield* call(sync, action, supported);',
      '}',
      'export function* goodSaga() {',
      '  yield* take([ready, replaced]);',
      '  while (true) { const external = yield* take(eventChannel); yield* call(forward, external); }',
      '  const queues = new Map<string, Channel<string>>();',
      '  const subscriptions = new Map<string, Subscription>();',
      '  const snapshots = new Map<string, { value: string }>();',
      '  const restoreHistoryIds = new Set<string>();',
      '  yield* takeEvery([start, stop], sameSemantics);',
      '  yield* takeLatest(load, loadWorker);',
      '}',
    ].join('\n');
    const result = inspectSagaWatcherOwnership([
      root(['goodSaga'], ["import { goodSaga } from './slices/good/sagas/good-saga';"]),
      { path: 'src/store/renderer/slices/good/sagas/good-saga.ts', content: source },
    ]);
    expect(result.violations).toEqual([]);
    expect(result.rootSagas).toEqual(['goodSaga']);
    expect(result.auditedFiles).toContain('src/store/renderer/slices/good/sagas/good-saga.ts');
  });

  it.each([
    ['wildcard takeEvery', "yield* takeEvery('*', worker);"],
    ['wildcard takeMaybe', "yield* takeMaybe('*');"],
    ['wildcard throttle', "yield* throttle(10, '*', worker);"],
    ['wildcard debounce', "yield* debounce(10, '*', worker);"],
    ['wildcard actionChannel', "yield* actionChannel('*');"],
    [
      'manual router',
      'const event = yield* take([start, stop]); if (event.type === start.type) yield* call(run);',
    ],
    ['Task registry', 'const buckets = new Map<string, { handle: Task }>();'],
    [
      'renamed fork registry',
      'const handle = yield* launch(worker); const buckets = new Map(); buckets.set("x", handle);',
    ],
  ])('rejects a %s', (_name, body) => {
    const source = [
      "import type { Task } from 'redux-saga';",
      "import { actionChannel, call, debounce, fork as launch, take, takeEvery, takeMaybe, throttle } from 'typed-redux-saga';",
      "import { start, stop } from '../slice';",
      `export function* badSaga() { ${body} }`,
    ].join('\n');
    const result = inspectSagaWatcherOwnership([
      root(['badSaga'], ["import { badSaga } from './slices/bad/sagas/bad-saga';"]),
      { path: 'src/store/renderer/slices/bad/sagas/bad-saga.ts', content: source },
    ]);
    expect(result.violations).toHaveLength(1);
  });

  it('rejects a manual Redux watcher loop while allowing channel loops', () => {
    const source = [
      "import { all, call, fork, join, take } from 'typed-redux-saga';",
      "import { start, stop } from '../slice';",
      'function* consumeExternal(channel: unknown) {',
      '  while (true) { const event = yield* take(channel); yield* call(forward, event); }',
      '}',
      'export function* badSaga() {',
      '  const handlers = [',
      '    yield* fork(function* () { while (true) yield* call(startWorker, yield* take(start)); }),',
      '    yield* fork(function* () { while (true) yield* call(stopWorker, yield* take(stop)); }),',
      '  ];',
      '  yield* all(handlers.map((task) => join(task)));',
      '}',
    ].join('\n');
    const result = inspectSagaWatcherOwnership([
      root(['badSaga'], ["import { badSaga } from './slices/bad/sagas/bad-saga';"]),
      { path: 'src/store/renderer/slices/bad/sagas/bad-saga.ts', content: source },
    ]);
    expect(result.violations).toEqual([
      expect.stringContaining('manual Redux watcher loop'),
      expect.stringContaining('manual Redux watcher loop'),
    ]);
  });

  it('rejects separated take and takeMaybe Redux watcher loops', () => {
    const source = [
      "import * as effects from 'typed-redux-saga';",
      "import { call, take as waitFor } from 'typed-redux-saga';",
      "import { eventsChannel as externalEvents } from '../channels';",
      "import * as actions from '../slice';",
      "import { start as begin } from '../slice';",
      'function* consumeExternal() {',
      '  while (true) {',
      '    const event = yield* waitFor(externalEvents);',
      '    yield* call(forward, event);',
      '  }',
      '}',
      'export function* badSaga() {',
      '  while (true) {',
      '    const startAction = yield* waitFor(begin);',
      '    yield* call(startWorker, startAction);',
      '    const stopAction = yield* effects.takeMaybe(actions.stop);',
      '    yield* effects.call(stopWorker, stopAction);',
      '  }',
      '}',
    ].join('\n');
    const result = inspectSagaWatcherOwnership([
      root(['badSaga'], ["import { badSaga } from './slices/bad/sagas/bad-saga';"]),
      { path: 'src/store/renderer/slices/bad/sagas/bad-saga.ts', content: source },
    ]);
    expect(result.violations).toEqual([
      expect.stringContaining('manual Redux watcher loop'),
      expect.stringContaining('manual Redux watcher loop'),
    ]);
  });

  it.each([
    'runningTasks',
    'workerRegistry',
    'slotMap',
    'debounceTasks',
    'fetchWorkers',
    'restoreTasks',
    'historyWorkers',
  ])('rejects camelCase execution registry %s', (name) => {
    const source = [
      "import { takeEvery } from 'typed-redux-saga';",
      "import { start } from '../slice';",
      `const ${name} = new Map();`,
      'export function* badSaga() { yield* takeEvery(start, worker); }',
    ].join('\n');
    const result = inspectSagaWatcherOwnership([
      root(['badSaga'], ["import { badSaga } from './slices/bad/sagas/bad-saga';"]),
      { path: 'src/store/renderer/slices/bad/sagas/bad-saga.ts', content: source },
    ]);
    expect(result.violations).toEqual([expect.stringContaining(`execution registry ${name}`)]);
  });

  it('rejects module-scope Task and custom-helper execution registries', () => {
    const source = [
      "import type { Task } from 'redux-saga';",
      "import { call, fork, takeEvery } from 'typed-redux-saga';",
      "import { start } from '../slice';",
      'const moduleTasks = new Map<string, Task>();',
      'function* createHandle() { return yield* fork(worker); }',
      'export function* badSaga() {',
      '  const buckets = new Map();',
      '  const handle = yield* call(createHandle);',
      '  buckets.set("key", handle);',
      '  yield* takeEvery(start, worker);',
      '}',
    ].join('\n');
    const result = inspectSagaWatcherOwnership([
      root(['badSaga'], ["import { badSaga } from './slices/bad/sagas/bad-saga';"]),
      { path: 'src/store/renderer/slices/bad/sagas/bad-saga.ts', content: source },
    ]);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.stringContaining('execution registry moduleTasks'),
        expect.stringContaining('execution registry buckets'),
      ]),
    );
  });

  it.each([
    ['if/else', 'if (action.type === "start") { yield* call(run); } else { yield* call(halt); }'],
    [
      'literal switch',
      'switch (action.type) { case "start": yield* call(run); break; case "stop": yield* call(halt); break; }',
    ],
  ])('rejects a shared multi-action %s execution dispatcher', (_name, routing) => {
    const source = [
      "import { call, takeEvery } from 'typed-redux-saga';",
      "import { start, stop } from '../slice';",
      'function* route(action: unknown) {',
      `  ${routing}`,
      '}',
      'export function* badSaga() {',
      '  yield* takeEvery([start, stop], route);',
      '}',
    ].join('\n');
    const result = inspectSagaWatcherOwnership([
      root(['badSaga'], ["import { badSaga } from './slices/bad/sagas/bad-saga';"]),
      { path: 'src/store/renderer/slices/bad/sagas/bad-saga.ts', content: source },
    ]);
    expect(result.violations).toEqual([
      expect.stringContaining('shared action.type execution dispatcher'),
    ]);
  });

  it('rejects duplicate watcher ownership for the same action', () => {
    const source = [
      "import { takeEvery, takeLatest } from 'typed-redux-saga';",
      "import { start } from '../slice';",
      'export function* badSaga() {',
      '  yield* takeEvery(start, firstWorker);',
      '  yield* takeLatest(start, secondWorker);',
      '}',
    ].join('\n');
    const result = inspectSagaWatcherOwnership([
      root(['badSaga'], ["import { badSaga } from './slices/bad/sagas/bad-saga';"]),
      { path: 'src/store/renderer/slices/bad/sagas/bad-saga.ts', content: source },
    ]);
    expect(result.violations).toEqual([expect.stringContaining('duplicate watcher ownership')]);
  });

  it('recognizes contextual watcher aliases for ownership and wildcard checks', () => {
    const source = [
      "import { takeLatestInContext, takeLeadingInContext as leading } from '$store/renderer/utils/context-saga-effects';",
      "import { load, start } from '../slice';",
      'export function* badSaga() {',
      '  yield* takeLatestInContext(load, getContext, loadWorker);',
      "  yield* leading('*', getContext, startWorker);",
      '}',
    ].join('\n');
    const result = inspectSagaWatcherOwnership([
      root(['badSaga'], ["import { badSaga } from './slices/bad/sagas/bad-saga';"]),
      { path: 'src/store/renderer/slices/bad/sagas/bad-saga.ts', content: source },
    ]);
    expect(result.watcherCount).toBe(1);
    expect(result.violations).toEqual([expect.stringContaining('wildcard Redux watcher')]);
  });

  it('recognizes workspace and agent contextual delegates as watcher owners', () => {
    const source = [
      "import { takeLatestByWorkspace, takeLeadingByAgent as byAgent } from '$store/renderer/utils/context-saga-effects';",
      "import { load, start } from '../slice';",
      'export function* badSaga() {',
      '  yield* takeLatestByWorkspace(load, loadWorker);',
      '  yield* byAgent(start, startWorker);',
      '}',
    ].join('\n');
    const result = inspectSagaWatcherOwnership([
      root(['badSaga'], ["import { badSaga } from './slices/bad/sagas/bad-saga';"]),
      { path: 'src/store/renderer/slices/bad/sagas/bad-saga.ts', content: source },
    ]);
    expect(result.watcherCount).toBe(2);
    expect(result.violations).toEqual([]);
  });

  it('recognizes effects called through supported namespace imports', () => {
    const source = [
      "import * as typedEffects from 'typed-redux-saga';",
      "import * as sagaEffects from 'redux-saga/effects';",
      "import * as contextEffects from '$store/renderer/utils/context-saga-effects';",
      "import { load, start, stop } from '../slice';",
      'export function* goodSaga() {',
      '  yield* typedEffects.takeEvery(load, loadWorker);',
      '  yield sagaEffects.takeLatest(start, startWorker);',
      '  yield* contextEffects.takeLeadingInContext(stop, getContext, stopWorker);',
      '}',
    ].join('\n');
    const result = inspectSagaWatcherOwnership([
      root(['goodSaga'], ["import { goodSaga } from './slices/good/sagas/good-saga';"]),
      { path: 'src/store/renderer/slices/good/sagas/good-saga.ts', content: source },
    ]);
    expect(result.watcherCount).toBe(3);
    expect(result.violations).toEqual([]);
  });

  it('detects duplicate ownership shared by native and contextual watchers', () => {
    const first = [
      "import { takeLatestInContext } from '$store/renderer/utils/context-saga-effects';",
      "import { start } from '$store/renderer/slices/shared/shared-slice';",
      'export function* firstSaga() {',
      '  yield* takeLatestInContext(start, getContext, firstWorker);',
      '}',
    ].join('\n');
    const second = [
      "import { takeLatest } from 'typed-redux-saga';",
      "import { start } from '$store/renderer/slices/shared/shared-slice';",
      'export function* secondSaga() { yield* takeLatest(start, secondWorker); }',
    ].join('\n');
    const result = inspectSagaWatcherOwnership([
      root(
        ['firstSaga', 'secondSaga'],
        [
          "import { firstSaga } from './slices/first/sagas/first-saga';",
          "import { secondSaga } from './slices/second/sagas/second-saga';",
        ],
      ),
      { path: 'src/store/renderer/slices/first/sagas/first-saga.ts', content: first },
      { path: 'src/store/renderer/slices/second/sagas/second-saga.ts', content: second },
    ]);
    expect(result.violations).toEqual([expect.stringContaining('duplicate watcher ownership')]);
  });

  it('follows directly composed child sagas outside the saga directory', () => {
    const parent = [
      "import { call } from 'typed-redux-saga';",
      "import { externalChild } from '$features/example/external-child';",
      'export function* parentSaga() { yield* call(externalChild); }',
    ].join('\n');
    const result = inspectSagaWatcherOwnership([
      root(['parentSaga'], ["import { parentSaga } from './slices/parent/sagas/parent-saga';"]),
      { path: 'src/store/renderer/slices/parent/sagas/parent-saga.ts', content: parent },
      {
        path: 'src/features/example/external-child.ts',
        content:
          "import { takeMaybe } from 'typed-redux-saga'; export function* externalChild() { yield* takeMaybe('*'); }",
      },
    ]);
    expect(result.auditedFiles).toContain('src/features/example/external-child.ts');
    expect(result.violations).toEqual([expect.stringContaining('wildcard Redux watcher')]);
  });

  it('rejects duplicate root registration', () => {
    const result = inspectSagaWatcherOwnership([
      root(['oneSaga', 'oneSaga'], ["import { oneSaga } from './slices/one/sagas/one-saga';"]),
      {
        path: 'src/store/renderer/slices/one/sagas/one-saga.ts',
        content: 'export function* oneSaga() {}',
      },
    ]);
    expect(result.violations).toEqual([
      expect.stringContaining('duplicate root saga registration'),
    ]);
  });

  it('reports malformed source without throwing on parse diagnostics', () => {
    const result = inspectSagaWatcherOwnership([
      root(['badSaga'], ["import { badSaga } from './slices/bad/sagas/bad-saga';"]),
      {
        path: 'src/store/renderer/slices/bad/sagas/bad-saga.ts',
        content: 'export function* badSaga() { yield*',
      },
    ]);
    expect(result.violations).toEqual([
      'src/store/renderer/slices/bad/sagas/bad-saga.ts:1: TypeScript parse failure',
    ]);
  });
});
