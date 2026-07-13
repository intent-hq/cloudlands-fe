import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
  it('flags imports of active/current workspace selectors in selector modules', () => {
    withFixture(
      {
        'example-selectors.ts': `
          import { selectActiveWorkspaceId } from '../workspace/workspace-selectors';
          import { store } from '$store/renderer/store';

          export const selectThing = store.createSelector((state) => state.thing);
        `,
      },
      (dir) => {
        const result = runGate(dir);
        expect(result.exitCode).toBe(1);
        expect(result.output).toContain('selectActiveWorkspaceId from ../workspace/workspace-selectors');
        expect(result.output).toContain('Pass workspaceId as a selector argument');
      },
    );
  });

  it('flags composed selector reads via .select and direct calls', () => {
    withFixture(
      {
        'example-selectors.ts': `
          import { selectCurrentWorkspace as selectWorkspace } from '../workspace/workspace-selectors';
          import { store } from '$store/renderer/store';

          export const selectTitle = store.createSelector((state) => {
            return selectWorkspace.select(state)?.title ?? '';
          });

          export const selectDirect = store.createSelector((state) => {
            return selectWorkspace(state)?.id ?? '';
          });
        `,
      },
      (dir) => {
        const result = runGate(dir);
        expect(result.exitCode).toBe(1);
        expect(result.output).toContain('[selector.select]');
        expect(result.output).toContain('[direct selector call]');
      },
    );
  });

  it('flags namespace-import usage of active/current workspace selectors', () => {
    withFixture(
      {
        'example-selectors.ts': `
          import * as workspaceSelectors from '../workspace/workspace-selectors';
          import { store } from '$store/renderer/store';

          export const selectTitle = store.createSelector((state) => {
            return workspaceSelectors.selectActiveWorkspaceId.select(state) ?? '';
          });

          export const selectDirect = store.createSelector((state) => {
            return workspaceSelectors.selectCurrentWorkspace(state)?.id ?? '';
          });
        `,
      },
      (dir) => {
        const result = runGate(dir);
        expect(result.exitCode).toBe(1);
        expect(result.output).toContain('[namespace selector.select]');
        expect(result.output).toContain('[namespace direct selector call]');
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
        expect(result.exitCode).toBe(0);
        expect(result.output).toContain('No new selector active-workspace violations');
      },
    );
  });
});