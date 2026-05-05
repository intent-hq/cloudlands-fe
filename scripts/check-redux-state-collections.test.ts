import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const scriptPath = join(repoRoot, 'scripts/check-redux-state-collections.mjs');

function withFixture(files: Record<string, string>, run: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'redux-collections-gate-'));
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

describe('Redux state Collection gate', () => {
  it('flags entity/object arrays in Redux state types', () => {
    withFixture(
      {
        'example-types.ts': `
          type Todo = { id: string; title: string };
          type Task = { id: string; label: string };
          export type TodoSearchResult = {
            todos: Todo[];
            tasks: Array<Task>;
          };
          export type SaveStatePayload = {
            todos: Todo[];
          };
          export type ExampleState = {
            todos: Todo[];
            tasksByWorkspace: Record<string, Array<Task>>;
            inlineObjects: { id: string; title: string }[];
          };
        `,
      },
      (dir) => {
        const result = runGate(dir);
        expect(result.exitCode).toBe(1);
        expect(result.output).toContain('ExampleState.todos');
        expect(result.output).toContain('ExampleState.tasksByWorkspace');
        expect(result.output).toContain('ExampleState.inlineObjects');
        expect(result.output).not.toContain('TodoSearchResult');
        expect(result.output).not.toContain('SaveStatePayload');
        expect(result.output).toContain('Collection<T, K>');
      },
    );
  });

  it('allows non-state entity array types in store slice directories', () => {
    withFixture(
      {
        'save-state-types.ts': `
          type Todo = { id: string; title: string };
          export type TodoSearchResult = {
            todos: Todo[];
            inlineObjects: { id: string; title: string }[];
          };
          export type SaveStatePayload = {
            todos: Todo[];
          };
        `,
      },
      (dir) => {
        const result = runGate(dir);
        expect(result.exitCode).toBe(0);
      },
    );
  });

  it('uses the slice directory name for slice-local types.ts state declarations', () => {
    withFixture(
      {
        'example/types.ts': `
          type Todo = { id: string; title: string };
          export type ExampleState = {
            todos: Todo[];
          };
        `,
      },
      (dir) => {
        const result = runGate(dir);
        expect(result.exitCode).toBe(1);
        expect(result.output).toContain('ExampleState.todos');
      },
    );
  });

  it('ignores SaveStatePayload while flagging the true SaveState slice state', () => {
    withFixture(
      {
        'save-state-types.ts': `
          type Todo = { id: string; title: string };
          export type SaveStatePayload = {
            todos: Todo[];
          };
          export type SaveState = {
            todos: Todo[];
          };
        `,
      },
      (dir) => {
        const result = runGate(dir);
        expect(result.exitCode).toBe(1);
        expect(result.output).toContain('SaveState.todos');
        expect(result.output).not.toContain('SaveStatePayload');
      },
    );
  });

  it('allows primitive arrays and ID arrays in Redux state', () => {
    withFixture(
      {
        'example-types.ts': `
          type WorkspaceId = string & { readonly brand: unique symbol };
          export interface ExampleState {
            names: string[];
            counts: Array<number>;
            flags: boolean[];
            statuses: Array<'open' | 'closed'>;
            workspaceIds: WorkspaceId[];
            agentIdsByWorkspace: Record<string, string[]>;
          }
        `,
      },
      (dir) => {
        const result = runGate(dir);
        expect(result.exitCode).toBe(0);
      },
    );
  });

  it('allows Collection fields in Redux state', () => {
    withFixture(
      {
        'example-types.ts': `
          import type { Collection } from '../../utils/collection-utils';

          type Todo = { id: string; title: string };
          export type ExampleState = {
            todos: Collection<Todo, 'id'>;
            selectedTodoIds: string[];
          };
        `,
      },
      (dir) => {
        const result = runGate(dir);
        expect(result.exitCode).toBe(0);
      },
    );
  });
});
