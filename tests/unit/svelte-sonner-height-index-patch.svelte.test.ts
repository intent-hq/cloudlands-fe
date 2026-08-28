import { createRequire } from 'node:module';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

type Height = { toastId: string | number; height: number };
type PatchedToastState = {
  create(data: { id: string; message: string }): string | number;
  heights: Height[];
  removeHeight(id: string | number): void;
  reset(): void;
  setHeight(data: Height): void;
};

const require = createRequire(import.meta.url);
const patchedModulePath = path.join(
  path.dirname(require.resolve('svelte-sonner')),
  'toast-state.svelte.js',
);

const { toastState } = (await import(/* @vite-ignore */ patchedModulePath)) as {
  toastState: PatchedToastState;
};

// Regression guard for the heights bookkeeping our local 1.1.1 patch used to
// fix; since svelte-sonner 1.2.1 the fix is upstream (setHeight looks entries
// up by toast id and keeps heights newest-first, matching the toasts order).
describe('svelte-sonner toast height indexing (upstream since 1.2.1)', () => {
  beforeEach(() => toastState.reset());
  afterEach(() => toastState.reset());

  it('keeps heights compact when toast order and measurement order differ', () => {
    toastState.create({ id: 'first', message: 'First' });
    toastState.create({ id: 'second', message: 'Second' });

    toastState.setHeight({ toastId: 'first', height: 40 });

    expect(() =>
      toastState.heights.findIndex((height) => height.toastId === 'first'),
    ).not.toThrow();
    expect(toastState.heights).toEqual([{ toastId: 'first', height: 40 }]);

    toastState.setHeight({ toastId: 'first', height: 40 });
    expect(toastState.heights).toEqual([{ toastId: 'first', height: 40 }]);

    toastState.setHeight({ toastId: 'first', height: 48 });
    expect(toastState.heights).toEqual([{ toastId: 'first', height: 48 }]);
    toastState.removeHeight('first');

    expect(toastState.heights).toEqual([]);
  });
});
