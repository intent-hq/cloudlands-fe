// @verify-changed-triggers: src/**/*.svelte, src/store/renderer/slices/**/*-slice.ts

import { describe, expect, it } from 'vitest';
import { findComponentAsyncBoundaryViolations } from './check-component-async-boundaries.mjs';

const asyncActionSource = {
  path: 'src/store/renderer/slices/tasks/tasks-slice.ts',
  content: [
    "import { createAsyncAction as asyncAction } from '@augmentcode/themis/utils/store/create-action';",
    "export const loadTasksRequested = asyncAction<[string], string[]>('tasks/load', 'loadTasks');",
  ].join('\n'),
};

const component = (content: string, path = 'src/features/tasks/TaskList.svelte') => ({
  path,
  content: `<script lang="ts">
    import { loadTasksRequested as requestTasks } from '$store/renderer/slices/tasks/tasks-slice';
    import { store as appStore } from '$store/renderer/store';
    ${content}
  </script>`,
});

describe('component async boundary checker', () => {
  it('rejects direct and dispatch-return async-action promise consumption', () => {
    const violations = findComponentAsyncBoundaryViolations([
      asyncActionSource,
      component(`
        async function direct() {
          const action = requestTasks('one');
          appStore.dispatch(action);
          await action.promise;
        }
        async function returned() {
          const action = appStore.dispatch(requestTasks('two'));
          return action.promise;
        }
      `),
    ]);

    expect(violations).toHaveLength(2);
    expect(violations.every((violation) => violation.includes('loadTasksRequested.promise'))).toBe(
      true,
    );
  });

  it('rejects an immediate selector result read after async dispatch', () => {
    const violations = findComponentAsyncBoundaryViolations([
      asyncActionSource,
      component(`
        function loadAndRead() {
          const request = requestTasks('one');
          appStore.dispatch(request);
          const result = selectTasks.select(appStore.state);
          return result;
        }
      `),
    ]);

    expect(violations).toEqual([
      expect.stringContaining('selector read immediately follows async dispatch'),
    ]);
  });

  it('allows selector reads before dispatch and unrelated UI-only promises', () => {
    const violations = findComponentAsyncBoundaryViolations([
      asyncActionSource,
      component(`
        async function coordinateUi() {
          const before = selectTasks.select(appStore.state);
          appStore.dispatch(requestTasks('one'));
          const frame = new Promise(requestAnimationFrame);
          await frame;
          return uiCoordination.promise;
        }
      `),
    ]);

    expect(violations).toEqual([]);
  });

  it('keeps the reviewed clear-epoch coordination exception exact', () => {
    const candidate = component(
      `
        function reload() {
          appStore.dispatch(requestTasks('one'));
          return selectProviderModelsClearEpoch.select(appStore.state);
        }
      `,
      'src/lib/components/chat/input/ModelPicker.svelte',
    );
    candidate.content = candidate.content.replaceAll(
      'loadTasksRequested',
      'loadProviderModelsRequested',
    );
    const source = {
      ...asyncActionSource,
      path: 'src/store/renderer/slices/provider-models/provider-models-slice.ts',
      content: asyncActionSource.content.replaceAll(
        'loadTasksRequested',
        'loadProviderModelsRequested',
      ),
    };

    expect(findComponentAsyncBoundaryViolations([source, candidate])).toEqual([]);
    expect(
      findComponentAsyncBoundaryViolations([
        source,
        { ...candidate, path: 'src/features/tasks/UnreviewedModelPicker.svelte' },
      ]),
    ).toHaveLength(1);
  });

  it('keeps the reviewed browser-navigation coordination exception exact', () => {
    const allowed = component(
      `
        function navigate() {
          const action = requestTasks('one');
          appStore.dispatch(action);
          return action.promise;
        }
      `,
      'src/features/layout/tab-types/BrowserTabType.svelte',
    );
    allowed.content = allowed.content.replaceAll(
      'loadTasksRequested',
      'navigateBrowserTabRequested',
    );
    const source = {
      ...asyncActionSource,
      path: 'src/store/renderer/slices/browser-clients/browser-clients-slice.ts',
      content: asyncActionSource.content.replaceAll(
        'loadTasksRequested',
        'navigateBrowserTabRequested',
      ),
    };

    expect(findComponentAsyncBoundaryViolations([source, allowed])).toEqual([]);
    allowed.content = allowed.content.replace(
      '</script>',
      `
        function navigateAgain() {
          const action = navigateBrowserTabRequested('two');
          appStore.dispatch(action);
          return action.promise;
        }
      </script>`,
    );
    expect(findComponentAsyncBoundaryViolations([source, allowed])).toHaveLength(1);
    expect(
      findComponentAsyncBoundaryViolations([
        source,
        { ...allowed, path: 'src/features/layout/tab-types/UnreviewedBrowserTab.svelte' },
      ]),
    ).toHaveLength(2);
  });

  it('rejects reintroducing promise consumption in corrected connection components', () => {
    const source = {
      ...asyncActionSource,
      path: 'src/store/renderer/slices/connections/connections-slice.ts',
      content: asyncActionSource.content.replaceAll(
        'loadTasksRequested',
        'openConnectionRequested',
      ),
    };
    const correctedPath = 'src/lib/components/layout/DaemonStatusIndicator.svelte';
    const candidate = component(
      `
        async function open() {
          const action = requestTasks('one');
          appStore.dispatch(action);
          await action.promise;
        }
      `,
      correctedPath,
    );
    candidate.content = candidate.content.replaceAll(
      'loadTasksRequested',
      'openConnectionRequested',
    );

    expect(findComponentAsyncBoundaryViolations([source, candidate])).toHaveLength(1);
  });
});
