import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const scriptPath = join(repoRoot, 'scripts/check-selector-active-workspace-hygiene.mjs');

function withFixture(files: Record<string, string>, run: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'selector-active-workspace-gate-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, name)), { recursive: true });
      writeFileSync(join(dir, name), content);
    }
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runGate(dir: string) {
  try {
    const stdout = execFileSync(process.execPath, [scriptPath, dir], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { exitCode: 0, output: stdout };
  } catch (error) {
    const err = error as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      exitCode: err.status ?? 1,
      output: `${err.stdout?.toString() ?? ''}${err.stderr?.toString() ?? ''}`,
    };
  }
}

describe('selector active-workspace hygiene gate', () => {
  it('keeps the file bridge seeder independent of active workspace selection', () => {
    const seeder = readFileSync(
      join(repoRoot, 'src/store/renderer/seeders/file-bridge-seeder.ts'),
      'utf8',
    );
    expect(seeder).not.toContain('resolveWorkspaceId');
  });

  it('flags every active/current workspace selector import in non-component modules', () => {
    withFixture(
      {
        'example-selectors.ts': `
          import { selectActiveWorkspace } from '../workspace/workspace-selectors';
          import { selectCurrentWorkspace } from '../workspace/workspace-selectors';
            import { selectCurrentWorkspaceId } from '../workspace/workspace-selectors';
          import { store } from '$store/renderer/store';

          export const selectThing = store.createSelector((state) => state.thing);
        `,
      },
      (dir) => {
        const result = runGate(dir);
        expect(result.exitCode).toBe(1);
        expect(result.output).toContain(
          'selectActiveWorkspace from ../workspace/workspace-selectors',
        );
        expect(result.output).toContain(
          'selectCurrentWorkspace from ../workspace/workspace-selectors',
        );
        expect(result.output).toContain(
          'selectCurrentWorkspaceId from ../workspace/workspace-selectors',
        );
        expect(result.output).toContain('Pass workspaceId as a selector argument');
      },
    );
  });

  it('flags non-component selector reads via .select and direct calls', () => {
    withFixture(
      {
        'example-selectors.ts': `
          import {
            selectActiveWorkspace as selectActive,
            selectCurrentWorkspace as selectCurrent,
            selectCurrentWorkspaceId as selectCurrentId,
          } from '../workspace/workspace-selectors';
          import { store } from '$store/renderer/store';

          export const selectTitle = store.createSelector((state) => {
            return selectActive.select(state)?.title ??
              selectCurrent.select(state)?.title ??
              selectCurrentId.select(state) ?? '';
          });

          export const selectDirect = store.createSelector((state) => {
            return selectActive(state) ??
              selectCurrent(state) ??
              selectCurrentId(state) ?? '';
          });
        `,
      },
      (dir) => {
        const result = runGate(dir);
        expect(result.exitCode).toBe(1);
        expect(result.output).toContain('[non-component selector.select]');
        expect(result.output).toContain('[non-component direct selector call]');
      },
    );
  });

  it('flags namespace-import usage of every active/current workspace selector', () => {
    withFixture(
      {
        'example-selectors.ts': `
          import * as workspaceSelectors from '../workspace/workspace-selectors';
          import { store } from '$store/renderer/store';

          export const selectTitle = store.createSelector((state) => {
            return workspaceSelectors.selectActiveWorkspace.select(state) ??
              workspaceSelectors.selectCurrentWorkspace.select(state) ??
              workspaceSelectors.selectCurrentWorkspaceId.select(state) ?? '';
          });

          export const selectDirect = store.createSelector((state) => {
            return workspaceSelectors.selectActiveWorkspace(state) ??
              workspaceSelectors.selectCurrentWorkspace(state) ??
              workspaceSelectors.selectCurrentWorkspaceId(state) ?? '';
          });
        `,
      },
      (dir) => {
        const result = runGate(dir);
        expect(result.exitCode).toBe(1);
        expect(result.output).toContain('[non-component selector.select]');
        expect(result.output).toContain('[non-component direct selector call]');
      },
    );
  });

  it('allows selectors that accept workspaceId as an argument', () => {
    withFixture(
      {
        'example-selectors.ts': `
          import { store } from '$store/renderer/store';

          export const selectWorkspaceThing = store.createSelector((state, workspaceId: string) => {
            return state.things.byWorkspaceId[workspaceId] ?? null;
          });
        `,
      },
      (dir) => {
        const result = runGate(dir);
        expect(result.exitCode, result.output).toBe(0);
        expect(result.output).toContain('No selector active-workspace violations');
      },
    );
  });

  it('flags direct active-workspace selector effects in sagas', () => {
    withFixture(
      {
        'example-saga.ts': `
          import { selectActiveWorkspace } from './workspace-selectors';

          export function* exampleSaga() {
            return yield* selectActiveWorkspace.effect();
          }
        `,
      },
      (dir) => {
        const result = runGate(dir);
        expect(result.exitCode).toBe(1);
        expect(result.output).toContain('[saga selector.effect]');
      },
    );
  });

  it('flags active-workspace selectors passed to selector channels', () => {
    withFixture(
      {
        'example-saga.ts': `
          import { takeLatestFromSelector } from '@augmentcode/themis/saga';
          import { selectActiveWorkspace } from './workspace-selectors';

          export function* exampleSaga() {
            yield* takeLatestFromSelector(selectActiveWorkspace, function* () {});
          }
        `,
      },
      (dir) => {
        const result = runGate(dir);
        expect(result.exitCode).toBe(1);
        expect(result.output).toContain('[saga selector channel]');
      },
    );
  });

  it('flags transitive saga selectors that read raw active-workspace state', () => {
    withFixture(
      {
        'bad-selectors.ts': `
          import { store } from './store';

          export const selectDividerSnapshot = store.createSelector((state) => ({
            workspaceId: state.workspace.activeWorkspaceId,
          }));
        `,
        'example-saga.ts': `
          import { selectDividerSnapshot } from './bad-selectors';

          export function* exampleSaga() {
            return yield* selectDividerSnapshot.effect();
          }
        `,
      },
      (dir) => {
        const result = runGate(dir);
        expect(result.exitCode).toBe(1);
        expect(result.output).toContain('[saga selector.effect]');
        expect(result.output).toContain('selectDividerSnapshot.effect()');
      },
    );
  });

  it('flags transitive selector helpers that read raw active-workspace state', () => {
    withFixture(
      {
        'bad-selectors.ts': `
          import { store } from './store';

          function getActiveWorkspaceState(state) {
            return state.workspace.activeWorkspaceId;
          }

          export const selectDividerSnapshot = store.createSelector((state) => ({
            workspaceId: getActiveWorkspaceState(state),
          }));
        `,
        'example-saga.ts': `
          import { selectDividerSnapshot } from './bad-selectors';

          export function* exampleSaga() {
            return yield* selectDividerSnapshot.effect();
          }
        `,
      },
      (dir) => {
        const result = runGate(dir);
        expect(result.exitCode).toBe(1);
        expect(result.output).toContain('[saga selector.effect]');
      },
    );
  });

  it('flags arbitrary local saga helpers that reach imported active-workspace dependencies', () => {
    withFixture(
      {
        'src/shared/workspace-helper.ts': `
          export function readWorkspaceId(state) {
            return state.workspace.activeWorkspaceId;
          }
        `,
        'src/store/renderer/sagas/example-saga.ts': `
          import { readWorkspaceId } from '../../../shared/workspace-helper';

          function getWorkspaceId(state) {
            return readWorkspaceId(state);
          }

          export function* exampleSaga(state) {
            return getWorkspaceId(state);
          }
        `,
      },
      (dir) => {
        const result = runGate(dir);
        expect(result.exitCode).toBe(1);
        expect(result.output).toContain('[saga transitive active-workspace dependency]');
        expect(result.output).toContain('getWorkspaceId(state)');
      },
    );
  });

  it('flags imported aliases and namespace helpers through barrel re-exports', () => {
    withFixture(
      {
        'src/shared/workspace-helper.ts': `
          export function readWorkspaceId(state) {
            return state.workspace.activeWorkspaceId;
          }
        `,
        'src/shared/index.ts': `
          export { readWorkspaceId as getWorkspaceId } from './workspace-helper';
        `,
        'src/store/renderer/sagas/example-saga.ts': `
          import { getWorkspaceId as resolveWorkspaceId } from '../../../shared';
          import * as workspaceHelpers from '../../../shared';

          const localWorkspaceLookup = resolveWorkspaceId;

          export function* exampleSaga(state) {
            localWorkspaceLookup(state);
            return workspaceHelpers.getWorkspaceId(state);
          }
        `,
      },
      (dir) => {
        const result = runGate(dir);
        expect(result.exitCode).toBe(1);
        expect(result.output).toContain('[saga transitive active-workspace dependency]');
        expect(result.output).toContain('localWorkspaceLookup(state)');
        expect(result.output).toContain('workspaceHelpers.getWorkspaceId(state)');
      },
    );
  });

  it('flags arbitrary active-workspace helper dependencies at non-component call sites', () => {
    withFixture(
      {
        'src/shared/workspace-helper.ts': `
          export function getWorkspaceId(state) {
            return state.workspace.activeWorkspaceId;
          }
        `,
        'src/lib/workspace-service.ts': `
          import * as workspaceHelpers from '../shared/workspace-helper';

          export function resolveWorkspaceId(state) {
            return workspaceHelpers.getWorkspaceId(state);
          }
        `,
      },
      (dir) => {
        const result = runGate(dir);
        expect(result.exitCode).toBe(1);
        expect(result.output).toContain('[non-component transitive active-workspace dependency]');
        expect(result.output).toContain('workspaceHelpers.getWorkspaceId(state)');
      },
    );
  });

  it('allows arbitrary helpers that use an explicit workspaceId', () => {
    withFixture(
      {
        'src/shared/workspace-helper.ts': `
          export function readWorkspaceId(workspaceId: string) {
            return workspaceId;
          }
        `,
        'src/shared/index.ts': `
          export { readWorkspaceId as getWorkspaceId } from './workspace-helper';
        `,
        'src/store/renderer/sagas/example-saga.ts': `
          import { getWorkspaceId as resolveWorkspaceId } from '../../../shared';
          import * as workspaceHelpers from '../../../shared';

          function getWorkspaceId(workspaceId: string) {
            return resolveWorkspaceId(workspaceId);
          }

          export function* exampleSaga(workspaceId: string) {
            getWorkspaceId(workspaceId);
            return workspaceHelpers.getWorkspaceId(workspaceId);
          }
        `,
        'src/lib/workspace-service.ts': `
          import { getWorkspaceId } from '../shared';

          export function resolveWorkspaceId(workspaceId: string) {
            return getWorkspaceId(workspaceId);
          }
        `,
      },
      (dir) => {
        const result = runGate(dir);
        expect(result.exitCode).toBe(0);
        expect(result.output).toContain('No selector active-workspace violations');
      },
    );
  });

  it('flags local and barrel-aliased active-workspace helpers passed to saga effects', () => {
    withFixture(
      {
        'src/shared/workspace-helper.ts': `
          export function readWorkspaceId(state) {
            return state.workspace.activeWorkspaceId;
          }
        `,
        'src/shared/index.ts': `
          export { readWorkspaceId as getWorkspaceId } from './workspace-helper';
        `,
        'src/store/renderer/sagas/example-saga.ts': `
          import { call } from 'typed-redux-saga';
          import { getWorkspaceId as resolveWorkspaceId } from '../../../shared';

          const localWorkspaceLookup = resolveWorkspaceId;

          function* readWorkspaceId(state) {
            return yield* call(localWorkspaceLookup, state);
          }

          export function* exampleSaga(state) {
            yield* call(localWorkspaceLookup, state);
            return yield* call(readWorkspaceId, state);
          }
        `,
      },
      (dir) => {
        const result = runGate(dir);
        expect(result.exitCode).toBe(1);
        expect(result.output).toContain('[saga effect active-workspace dependency]');
        expect(result.output).toContain('call(localWorkspaceLookup, state)');
        expect(result.output).toContain('call(readWorkspaceId, state)');
      },
    );
  });

  it('flags default-imported active-workspace helpers passed to saga effects', () => {
    withFixture(
      {
        'src/shared/workspace-helper.ts': `
          export default function getWorkspaceId(state) {
            return state.workspace.activeWorkspaceId;
          }
        `,
        'src/store/renderer/sagas/example-saga.ts': `
          import { call } from 'typed-redux-saga';
          import getWorkspaceId from '../../../shared/workspace-helper';

          export function* exampleSaga(state) {
            return yield* call(getWorkspaceId, state);
          }
        `,
      },
      (dir) => {
        const result = runGate(dir);
        expect(result.exitCode).toBe(1);
        expect(result.output).toContain('[saga effect active-workspace dependency]');
        expect(result.output).toContain('call(getWorkspaceId, state)');
      },
    );
  });

  it('flags computed and destructured namespace helpers passed to saga effects', () => {
    withFixture(
      {
        'src/shared/workspace-helper.ts': `
          export function getWorkspaceId(state) {
            return state.workspace.activeWorkspaceId;
          }
        `,
        'src/shared/index.ts': `
          export * from './workspace-helper';
        `,
        'src/store/renderer/sagas/example-saga.ts': `
          import { call } from 'typed-redux-saga';
          import * as workspaceHelpers from '../../../shared';

          const { getWorkspaceId: resolveWorkspaceId } = workspaceHelpers;

          export function* exampleSaga(state) {
            yield* call(workspaceHelpers['getWorkspaceId'], state);
            return yield* call(resolveWorkspaceId, state);
          }
        `,
      },
      (dir) => {
        const result = runGate(dir);
        expect(result.exitCode).toBe(1);
        expect(result.output).toContain('[saga effect active-workspace dependency]');
        expect(result.output).toContain("call(workspaceHelpers['getWorkspaceId'], state)");
        expect(result.output).toContain('call(resolveWorkspaceId, state)');
      },
    );
  });

  it('flags imported object-method helpers passed to saga effects through alias paths', () => {
    withFixture(
      {
        'src/shared/workspace-helper.ts': `
          export const workspaceHelpers = {
            getWorkspaceId(state) {
              return state.workspace.activeWorkspaceId;
            },
          };
        `,
        'src/shared/index.ts': `
          export { workspaceHelpers } from './workspace-helper';
        `,
        'src/store/renderer/sagas/example-saga.ts': `
          import { call } from 'typed-redux-saga';
          import { workspaceHelpers } from '$shared';

          export function* exampleSaga(state) {
            return yield* call(workspaceHelpers.getWorkspaceId, state);
          }
        `,
      },
      (dir) => {
        const result = runGate(dir);
        expect(result.exitCode).toBe(1);
        expect(result.output).toContain('[saga effect active-workspace dependency]');
        expect(result.output).toContain('call(workspaceHelpers.getWorkspaceId, state)');
      },
    );
  });

  it('flags nested object methods through namespace-export barrels', () => {
    withFixture(
      {
        'src/shared/helper.ts': `
          export const workspaceHelpers = {
            getWorkspaceId(state) {
              return state.workspace.activeWorkspaceId;
            },
          };
        `,
        'src/shared/index.ts': `
          export * as helpers from './helper';
        `,
        'src/store/renderer/sagas/example-saga.ts': `
          import { call } from 'typed-redux-saga';
          import { helpers } from '$shared';

          export function* exampleSaga(state) {
            return yield* call(helpers.workspaceHelpers.getWorkspaceId, state);
          }
        `,
      },
      (dir) => {
        const result = runGate(dir);
        expect(result.exitCode).toBe(1);
        expect(result.output).toContain('[saga effect active-workspace dependency]');
        expect(result.output).toContain('call(helpers.workspaceHelpers.getWorkspaceId, state)');
      },
    );
  });

  it('allows every saga callable-reference form when helpers use explicit workspaceId', () => {
    withFixture(
      {
        'src/shared/default-workspace-helper.ts': `
          export default function getWorkspaceId(workspaceId: string) {
            return workspaceId;
          }
        `,
        'src/shared/workspace-helper.ts': `
          export function getWorkspaceId(workspaceId: string) {
            return workspaceId;
          }

          export const workspaceHelpers = {
            getWorkspaceId(workspaceId: string) {
              return workspaceId;
            },
          };
        `,
        'src/shared/index.ts': `
          export * from './workspace-helper';
        `,
        'src/shared/namespaced-index.ts': `
          export * as helpers from './workspace-helper';
        `,
        'src/store/renderer/sagas/example-saga.ts': `
          import { call } from 'typed-redux-saga';
          import defaultWorkspaceLookup from '../../../shared/default-workspace-helper';
          import { workspaceHelpers } from '$shared';
          import * as helpers from '../../../shared';
          import { helpers as namespacedHelpers } from '../../../shared/namespaced-index';

          const localWorkspaceLookup = defaultWorkspaceLookup;
          const { getWorkspaceId: resolveWorkspaceId } = helpers;

          export function* exampleSaga(workspaceId: string) {
            yield* call(localWorkspaceLookup, workspaceId);
            yield* call(helpers['getWorkspaceId'], workspaceId);
            yield* call(resolveWorkspaceId, workspaceId);
            return yield* call(workspaceHelpers.getWorkspaceId, workspaceId);
            yield* call(namespacedHelpers.workspaceHelpers.getWorkspaceId, workspaceId);
          }
        `,
      },
      (dir) => {
        const result = runGate(dir);
        expect(result.exitCode, result.output).toBe(0);
        expect(result.output).toContain('No selector active-workspace violations');
      },
    );
  });

  it('flags active-workspace reads through workspace-slice aliases', () => {
    withFixture(
      {
        'src/lib/service.ts': `
          export function getWorkspaceId(state) {
            const slice = state.workspace;
            return slice.activeWorkspaceId;
          }
        `,
      },
      (dir) => expect(runGate(dir).exitCode).toBe(1),
    );
  });

  it('flags active-workspace reads in destructured parameters', () => {
    withFixture(
      {
        'src/lib/service.ts': `
          export function getWorkspaceId({ workspace: { activeWorkspaceId } }) {
            return activeWorkspaceId;
          }
        `,
      },
      (dir) => expect(runGate(dir).exitCode).toBe(1),
    );
  });

  it('flags asserted computed active-workspace reads', () => {
    withFixture(
      {
        'src/lib/service.ts': `
          export function getWorkspaceId(state) {
            return state.workspace['activeWorkspaceId' as const];
          }
        `,
      },
      (dir) => expect(runGate(dir).exitCode).toBe(1),
    );
  });

  it('flags transitive helpers with destructured active-workspace reads', () => {
    withFixture(
      {
        'src/shared/helper.ts': `
          export function getWorkspaceId(state) {
            const { activeWorkspaceId } = state.workspace;
            return activeWorkspaceId;
          }
        `,
        'src/store/renderer/sagas/example-saga.ts': `
          import { getWorkspaceId } from '../../../shared/helper';
          export function* exampleSaga(state) { return getWorkspaceId(state); }
        `,
      },
      (dir) => expect(runGate(dir).exitCode).toBe(1),
    );
  });

  it('flags transitive helpers with destructured active-workspace parameters', () => {
    withFixture(
      {
        'src/shared/helper.ts': `
          export function getWorkspaceId({ workspace: { activeWorkspaceId } }) {
            return activeWorkspaceId;
          }
        `,
        'src/store/renderer/sagas/example-saga.ts': `
          import { getWorkspaceId } from '../../../shared/helper';
          export function* exampleSaga(state) { return getWorkspaceId(state); }
        `,
      },
      (dir) => expect(runGate(dir).exitCode).toBe(1),
    );
  });

  it('flags helpers reached through nested namespace destructuring', () => {
    withFixture(
      {
        'src/shared/helper.ts': `
          export const workspaceHelpers = {
            getWorkspaceId(state) { return state.workspace.activeWorkspaceId; },
          };
        `,
        'src/shared/index.ts': `export * as helpers from './helper';`,
        'src/store/renderer/sagas/example-saga.ts': `
          import { call } from 'typed-redux-saga';
          import { helpers } from '$shared';
          const { workspaceHelpers: { getWorkspaceId } } = helpers;
          export function* exampleSaga(state) {
            return yield* call(getWorkspaceId, state);
          }
        `,
      },
      (dir) => expect(runGate(dir).exitCode).toBe(1),
    );
  });

  it('flags conditional aliases with a forbidden callable branch', () => {
    withFixture(
      {
        'src/shared/helper.ts': `
          export function bad(state) { return state.workspace.activeWorkspaceId; }
          export function good(workspaceId) { return workspaceId; }
        `,
        'src/store/renderer/sagas/example-saga.ts': `
          import { call } from 'typed-redux-saga';
          import { bad, good } from '../../../shared/helper';
          const lookup = Math.random() > 0.5 ? bad : good;
          export function* exampleSaga(state) { return yield* call(lookup, state); }
        `,
      },
      (dir) => expect(runGate(dir).exitCode).toBe(1),
    );
  });

  it('flags forbidden class static callables', () => {
    withFixture(
      {
        'src/shared/helper.ts': `
          export class WorkspaceHelpers {
            static getWorkspaceId(state) { return state.workspace.activeWorkspaceId; }
          }
        `,
        'src/store/renderer/sagas/example-saga.ts': `
          import { call } from 'typed-redux-saga';
          import { WorkspaceHelpers } from '../../../shared/helper';
          export function* exampleSaga(state) {
            return yield* call(WorkspaceHelpers.getWorkspaceId, state);
          }
        `,
      },
      (dir) => expect(runGate(dir).exitCode).toBe(1),
    );
  });

  it('flags default-exported arrow helpers', () => {
    withFixture(
      {
        'src/shared/helper.ts': `
          export default (state) => state.workspace.activeWorkspaceId;
        `,
        'src/store/renderer/sagas/example-saga.ts': `
          import { call } from 'typed-redux-saga';
          import getWorkspaceId from '../../../shared/helper';
          export function* exampleSaga(state) {
            return yield* call(getWorkspaceId, state);
          }
        `,
      },
      (dir) => expect(runGate(dir).exitCode).toBe(1),
    );
  });

  it('flags saga effects in generator modules with nonconventional filenames', () => {
    withFixture(
      {
        'src/shared/helper.ts': `
          export function getWorkspaceId(state) { return state.workspace.activeWorkspaceId; }
        `,
        'src/store/renderer/workspace-orchestration.ts': `
          import { call } from 'typed-redux-saga';
          import { getWorkspaceId } from '../../shared/helper';
          export function* exampleSaga(state) {
            return yield* call(getWorkspaceId, state);
          }
        `,
      },
      (dir) => expect(runGate(dir).exitCode).toBe(1),
    );
  });

  it('allows safe sibling properties in nested namespaces', () => {
    withFixture(
      {
        'src/shared/helper.ts': `
          export const workspaceHelpers = {
            getWorkspaceId(state) { return state.workspace.activeWorkspaceId; },
            explicit(workspaceId) { return workspaceId; },
          };
        `,
        'src/shared/index.ts': `export * as helpers from './helper';`,
        'src/store/renderer/sagas/example-saga.ts': `
          import { call } from 'typed-redux-saga';
          import { helpers } from '$shared';
          export function* exampleSaga(workspaceId) {
            return yield* call(helpers.workspaceHelpers.explicit, workspaceId);
          }
        `,
      },
      (dir) => expect(runGate(dir).exitCode).toBe(0),
    );
  });

  it('allows lexically shadowed safe helpers', () => {
    withFixture(
      {
        'src/shared/helper.ts': `
          export function getWorkspaceId(state) { return state.workspace.activeWorkspaceId; }
        `,
        'src/lib/service.ts': `
          import { getWorkspaceId } from '../shared/helper';
          export function explicit(workspaceId) {
            const getWorkspaceId = (id) => id;
            return getWorkspaceId(workspaceId);
          }
        `,
      },
      (dir) => expect(runGate(dir).exitCode).toBe(0),
    );
  });

  it('flags raw active-workspace reads in non-saga production modules', () => {
    withFixture(
      {
        'example-service.ts': `
          export function getWorkspaceId(state) {
            return state.workspace.activeWorkspaceId;
          }
        `,
      },
      (dir) => {
        const result = runGate(dir);
        expect(result.exitCode).toBe(1);
        expect(result.output).toContain('[non-component raw active-workspace state read]');
        expect(result.output).toContain('state.workspace.activeWorkspaceId');
      },
    );
  });

  it('flags destructured raw active-workspace reads in production modules and sagas', () => {
    withFixture(
      {
        'example-service.ts': `
          export function read(state) {
            const { activeWorkspaceId } = state.workspace;
            return activeWorkspaceId;
          }
        `,
        'src/store/renderer/sagas/example-saga.ts': `
          export function* exampleSaga(state) {
            const { workspace: { activeWorkspaceId: nestedWorkspaceId } } = state;
            return nestedWorkspaceId;
          }
        `,
      },
      (dir) => {
        const result = runGate(dir);
        expect(result.exitCode).toBe(1);
        expect(result.output).toContain('[non-component raw active-workspace state read]');
        expect(result.output).toContain('{ activeWorkspaceId } = state.workspace');
        expect(result.output).toContain('[saga raw active-workspace state read]');
        expect(result.output).toContain('activeWorkspaceId: nestedWorkspaceId');
      },
    );
  });

  it('cannot conceal a raw read at an exact former baseline identity', () => {
    withFixture(
      {
        'src/features/hardware-console/encoder/encoder-service.ts': `${'\n'.repeat(93)}export function handleEncoderRotate(state) { return state.workspace.activeWorkspaceId; }\n`,
      },
      (dir) => {
        const result = runGate(dir);
        expect(result.exitCode).toBe(1);
        expect(result.output).toContain('[non-component raw active-workspace state read]');
      },
    );
  });

  it('contains no legacy raw-read baseline or compatibility machinery', () => {
    const gate = readFileSync(scriptPath, 'utf8');
    expect(gate).not.toContain('LEGACY_RAW_ACTIVE_WORKSPACE_BASELINE');
    expect(gate).not.toContain('isLegacyRawActiveWorkspaceRead');
    expect(gate).not.toContain('stale legacy raw active-workspace baseline');
  });

  it('allows only canonical active-workspace selector owners to read the raw field', () => {
    withFixture(
      {
        'src/store/renderer/slices/workspace/workspace-selectors.ts': `
          import { store } from '../../store';
          export const selectActiveWorkspace = store.createSelector((state) => {
            const workspaceId = state.workspace.activeWorkspaceId;
            return state.workspace.workspaces[workspaceId];
          });
        `,
      },
      (dir) => expect(runGate(dir).exitCode).toBe(0),
    );

    withFixture(
      {
        'src/store/renderer/slices/workspace/workspace-selectors.ts': `
          import { store } from '../../store';
          export const selectUnrelated = store.createSelector(
            (state) => state.workspace.activeWorkspaceId,
          );
        `,
      },
      (dir) => {
        const result = runGate(dir);
        expect(result.exitCode).toBe(1);
        expect(result.output).toContain('[non-component raw active-workspace state read]');
      },
    );
  });

  it('allows active workspace selection inside Svelte components', () => {
    withFixture(
      {
        'Example.svelte': `
          <script lang="ts">
            import { selectActiveWorkspace } from './workspace-selectors';
            const workspace = selectActiveWorkspace();
          </script>
        `,
        'explicit-selector.ts': `
          export const selectWorkspaceThing = {
            effect: (workspaceId: string) => workspaceId,
          };
        `,
        'example-saga.ts': `
          import { selectWorkspaceThing } from './explicit-selector';

          export function* exampleSaga(workspaceId: string) {
            return yield* selectWorkspaceThing.effect(workspaceId);
          }
        `,
      },
      (dir) => {
        const result = runGate(dir);
        expect(result.exitCode).toBe(0);
      },
    );
  });
});
