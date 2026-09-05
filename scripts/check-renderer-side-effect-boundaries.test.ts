import { describe, expect, it } from 'vitest';
import { findRendererSideEffectBoundaryViolations } from './check-renderer-side-effect-boundaries.mjs';

const registry = {
  path: 'src/store/renderer/middleware.ts',
  content: [
    "import { createStoreGuardMiddleware } from '../../store/utils/store-guard-middleware';",
    "import { createBatchingMiddleware } from './middlewares/batch';",
    "import { createReferenceChangeDetectorMiddleware } from './middlewares/state-reference-checks';",
    "import { createStructuredCloneCheckerMiddleware } from './middlewares/structured-clone-checker';",
    'createStoreGuardMiddleware()',
    'createBatchingMiddleware()',
    'createReferenceChangeDetectorMiddleware()',
    'createStructuredCloneCheckerMiddleware()',
  ].join('\n'),
};

const configuredStore = {
  path: 'src/store/renderer/configured-store.ts',
  content: [
    "import { Store } from '@augmentcode/themis/svelte-store';",
    "import { middleware } from './middleware';",
    "import { reducers } from './reducer';",
    'class RendererStore extends Store {}',
    'export const store = new RendererStore(reducers, middleware, { logReduxActions: false });',
  ].join('\n'),
};

describe('renderer side-effect boundary guard', () => {
  it('allows the four approved middleware and reusable non-middleware utilities', () => {
    const files = [
      registry,
      {
        path: 'src/features/agent/read-helper.ts',
        content: [
          '// registerMockIpcHandler() and createPersistenceMiddleware() are documentation only',
          'const example = "addMockIpcListener()";',
          'export async function load() { await backendRequest(); setTimeout(toast, 1); }',
        ].join('\n'),
      },
      {
        path: 'src/shared/type-system/validation.ts',
        content: 'export function createValidationMiddleware() { return validate; }',
      },
      {
        path: 'src/store/renderer/seeders/misc-ui-events-seeder.ts',
        content: [
          "import { registerMockIpcHandler as register } from '$shared/ipc-mock-router';",
          "register('window:open-new', async () => undefined);",
        ].join('\n'),
      },
    ];
    expect(findRendererSideEffectBoundaryViolations(files)).toEqual([]);
  });

  it('allows the configured Store to consume the central middleware registry exactly once', () => {
    expect(findRendererSideEffectBoundaryViolations([registry, configuredStore])).toEqual([]);
  });

  it('rejects a new business middleware factory', () => {
    const violations = findRendererSideEffectBoundaryViolations([
      registry,
      {
        path: 'src/features/tasks/task-service.ts',
        content: [
          "import type { StoreMiddleware as Middleware } from '@augmentcode/themis/types';",
          'export function buildTaskEffects(): Middleware { return (() => undefined) as never; }',
          'export const createTaskService = (): Middleware => (() => undefined) as never;',
        ].join('\n'),
      },
      {
        path: 'src/features/tasks/task-types.ts',
        content: "export type { StoreMiddleware as TaskEffects } from '@augmentcode/themis/types';",
      },
      {
        path: 'src/features/tasks/barrel-task-service.ts',
        content: [
          "import type { TaskEffects as Effects } from './task-types';",
          'export const makeTaskEffects = (): Effects => (() => undefined) as never;',
        ].join('\n'),
      },
    ]);
    expect(violations).toEqual(
      expect.arrayContaining([
        expect.stringContaining('StoreMiddleware is restricted'),
        expect.stringContaining('unapproved side-effect factory buildTaskEffects'),
        expect.stringContaining('unapproved side-effect factory createTaskService'),
        expect.stringContaining('unapproved side-effect factory makeTaskEffects'),
      ]),
    );
  });

  it('resolves StoreMiddleware through a namespace imported from a local barrel', () => {
    const violations = findRendererSideEffectBoundaryViolations([
      registry,
      {
        path: 'src/features/tasks/task-types.ts',
        content: "export type { StoreMiddleware } from '@augmentcode/themis/types';",
      },
      {
        path: 'src/features/tasks/task-effects.ts',
        content: [
          "import type * as effects from './task-types';",
          'export const buildTaskEffects = (): effects.StoreMiddleware => (() => undefined) as never;',
        ].join('\n'),
      },
    ]);
    expect(violations).toEqual([
      expect.stringContaining('unapproved side-effect factory buildTaskEffects'),
    ]);
  });

  it('rejects an untyped conventionally named renderer middleware factory', () => {
    const violations = findRendererSideEffectBoundaryViolations([
      registry,
      {
        path: 'src/features/tasks/task-middleware.ts',
        content: 'export function createTaskMiddleware() { return () => (next) => next; }',
      },
    ]);
    expect(violations).toEqual([
      expect.stringContaining(
        'task-middleware.ts: unapproved side-effect factory createTaskMiddleware',
      ),
    ]);
  });

  it('normalizes a local TypeScript barrel imported with a .js specifier', () => {
    const violations = findRendererSideEffectBoundaryViolations([
      registry,
      {
        path: 'src/features/tasks/task-types.ts',
        content: "export type { StoreMiddleware as TaskEffects } from '@augmentcode/themis/types';",
      },
      {
        path: 'src/features/tasks/task-effects.ts',
        content: [
          "import type { TaskEffects as Effects } from './task-types.js';",
          'export const buildTaskEffects = (): Effects => (() => undefined) as never;',
        ].join('\n'),
      },
    ]);
    expect(violations).toEqual(
      expect.arrayContaining([
        expect.stringContaining('StoreMiddleware is restricted'),
        expect.stringContaining('unapproved side-effect factory buildTaskEffects'),
      ]),
    );
  });

  it('rejects aliased, namespace, and barrel-reexported IPC bridge registrations', () => {
    const violations = findRendererSideEffectBoundaryViolations([
      registry,
      {
        path: 'src/features/tasks/task-bridge.ts',
        content: [
          "import { registerMockIpcHandler as register } from '$shared/ipc-mock-router';",
          "import * as ipc from '$shared/ipc-mock-router';",
          "register('task:list', async () => []);",
          "ipc.addMockIpcListener('task:changed', () => {});",
        ].join('\n'),
      },
      {
        path: 'src/features/tasks/task-bridge-barrel.ts',
        content:
          "export { registerMockIpcHandler as installTaskHandler } from '$shared/ipc-mock-router';",
      },
      {
        path: 'src/features/tasks/task-bridge-consumer.ts',
        content: [
          "import { installTaskHandler as wireTask } from './task-bridge-barrel';",
          "wireTask('task:get', async () => undefined);",
        ].join('\n'),
      },
    ]);
    expect(violations).toHaveLength(3);
    expect(violations).toEqual(
      expect.arrayContaining([
        expect.stringContaining('task-bridge.ts'),
        expect.stringContaining('task-bridge-consumer.ts'),
      ]),
    );
  });

  it('rejects direct Store middleware registration through constructor aliases and addMiddleware', () => {
    const violations = findRendererSideEffectBoundaryViolations([
      registry,
      {
        path: 'src/features/tasks/task-store-barrel.ts',
        content: "export { Store as RendererStore } from '@augmentcode/themis/svelte-store';",
      },
      {
        path: 'src/features/tasks/task-store.ts',
        content: [
          "import { RendererStore as TaskStore } from './task-store-barrel';",
          'const store = new TaskStore({}, [taskMiddleware]);',
          'store.addMiddleware(otherMiddleware);',
        ].join('\n'),
      },
    ]);
    expect(violations).toEqual([
      expect.stringContaining('direct Store middleware registration is not allowed'),
      expect.stringContaining('direct Store middleware registration is not allowed'),
    ]);
  });

  it.each([
    ['addMiddleware', `${configuredStore.content}\nstore.addMiddleware(undefined as never);`],
    [
      'a second Store constructor',
      `${configuredStore.content}\nnew Store(reducers, [undefined as never]);`,
    ],
  ])('rejects configured-store bypass through %s', (_bypass, content) => {
    expect(
      findRendererSideEffectBoundaryViolations([registry, { ...configuredStore, content }]),
    ).toEqual([
      expect.stringContaining(
        'src/store/renderer/configured-store.ts: direct Store middleware registration is not allowed',
      ),
    ]);
  });

  it.each([
    [
      'a function declaration parameter',
      [
        "import { Store } from '@augmentcode/themis/svelte-store';",
        'function install(store: Store) {',
        '  store.addMiddleware(otherMiddleware);',
        '}',
      ].join('\n'),
    ],
    [
      'an arrow function parameter',
      [
        "import { Store } from '@augmentcode/themis/svelte-store';",
        'const install = (store: Store) => {',
        '  store.addMiddleware(otherMiddleware);',
        '};',
      ].join('\n'),
    ],
    [
      'a class method parameter',
      [
        "import { Store } from '@augmentcode/themis/svelte-store';",
        'class Installer {',
        '  install(store: Store) {',
        '    store.addMiddleware(otherMiddleware);',
        '  }',
        '}',
      ].join('\n'),
    ],
    [
      'a namespace-qualified parameter type',
      [
        "import * as themis from '@augmentcode/themis/svelte-store';",
        'function install(store: themis.Store) {',
        '  store.addMiddleware(otherMiddleware);',
        '}',
      ].join('\n'),
    ],
  ])('rejects direct Store middleware registration via %s', (_variant, content) => {
    const violations = findRendererSideEffectBoundaryViolations([
      registry,
      { path: 'src/features/tasks/task-install.ts', content },
    ]);
    expect(violations).toEqual([
      expect.stringContaining('direct Store middleware registration is not allowed'),
    ]);
  });

  it('allows a non-Store-typed function parameter to call addMiddleware', () => {
    const violations = findRendererSideEffectBoundaryViolations([
      registry,
      {
        path: 'src/features/tasks/task-install.ts',
        content: [
          'function install(store: SomeOtherType) {',
          '  store.addMiddleware(otherMiddleware);',
          '}',
        ].join('\n'),
      },
    ]);
    expect(violations).toEqual([]);
  });

  it('allows unrelated objects that happen to expose addMiddleware', () => {
    expect(
      findRendererSideEffectBoundaryViolations([
        registry,
        {
          path: 'src/features/schema/schema.ts',
          content: 'schema.addMiddleware(validateSchema);',
        },
      ]),
    ).toEqual([]);
  });

  it('pins the Antigravity setup bridge seeder to its two reviewed registrations', () => {
    const seeder = (channels: string[]) => ({
      path: 'src/store/renderer/seeders/antigravity-setup-bridge-seeder.ts',
      content: [
        "import { registerMockIpcHandler } from '$shared/ipc-mock-router';",
        ...channels.map(
          (channel) => `registerMockIpcHandler('${channel}', async () => undefined);`,
        ),
      ].join('\n'),
    });
    expect(
      findRendererSideEffectBoundaryViolations([
        registry,
        seeder(['antigravity:setup', 'antigravity:close-setup']),
      ]),
    ).toEqual([]);
    expect(
      findRendererSideEffectBoundaryViolations([
        registry,
        seeder(['antigravity:setup', 'antigravity:close-setup', 'antigravity:unreviewed']),
      ]),
    ).toEqual([expect.stringContaining('reviewed renderer IPC bridge registrations changed')]);
  });

  it('rejects expansion of an approved bridge path', () => {
    const violations = findRendererSideEffectBoundaryViolations([
      registry,
      {
        path: 'src/store/renderer/seeders/misc-ui-events-seeder.ts',
        content: [
          "import { registerMockIpcHandler as register } from '$shared/ipc-mock-router';",
          "register('window:open-new', async () => undefined);",
          "register('window:unreviewed', async () => undefined);",
        ].join('\n'),
      },
    ]);
    expect(violations).toEqual([
      expect.stringContaining('reviewed renderer IPC bridge registrations changed'),
    ]);
  });

  it('rejects alternate-named calls in the approved middleware registry', () => {
    const violations = findRendererSideEffectBoundaryViolations([
      { ...registry, content: `${registry.content}\ninstallTaskEffects()` },
    ]);
    expect(violations).toEqual([
      expect.stringContaining(
        'registry must contain exactly the four approved middleware factories',
      ),
    ]);
  });

  it.each([
    ['removed', registry.content.replace('createBatchingMiddleware()\n', '')],
    [
      'replaced',
      registry.content.replace('createBatchingMiddleware()', 'createUnapprovedMiddleware()'),
    ],
    ['duplicated', `${registry.content}\ncreateBatchingMiddleware()`],
  ])('rejects an approved factory that is %s in the registry', (_change, content) => {
    expect(findRendererSideEffectBoundaryViolations([{ ...registry, content }])).toEqual([
      expect.stringContaining(
        'src/store/renderer/middleware.ts: registry must contain exactly the four approved middleware factories',
      ),
    ]);
  });

  it('fails closed on TypeScript parse diagnostics', () => {
    const violations = findRendererSideEffectBoundaryViolations([
      registry,
      {
        path: 'src/features/tasks/malformed.ts',
        content: 'export function malformed(: void {',
      },
    ]);
    expect(violations).toEqual([
      expect.stringContaining('malformed.ts:1: TypeScript parse failure'),
    ]);
  });
});
