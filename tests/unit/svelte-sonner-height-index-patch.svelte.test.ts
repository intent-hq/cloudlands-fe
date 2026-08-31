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
  toasts: Array<{ id: string | number }>;
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

  it('orders heights newest-first (aligned with toasts) when measured oldest-first', () => {
    // Create oldest -> newest; toastState.toasts is newest-first (unshift).
    toastState.create({ id: 'first', message: 'First' });
    toastState.create({ id: 'second', message: 'Second' });
    toastState.create({ id: 'third', message: 'Third' });
    expect(toastState.toasts.map((toast) => toast.id)).toEqual(['third', 'second', 'first']);

    // Measure in mount order oldest -> newest — the order that exposed the
    // original bug: appending here leaves heights oldest-first, so visible
    // (newest) toasts accumulate every hidden older toast's height as offset.
    toastState.setHeight({ toastId: 'first', height: 40 });
    toastState.setHeight({ toastId: 'second', height: 48 });
    toastState.setHeight({ toastId: 'third', height: 56 });

    // Must be spliced into the toasts-aligned (newest-first) position, not
    // appended: an append implementation produces [first, second, third].
    expect(toastState.heights).toEqual([
      { toastId: 'third', height: 56 },
      { toastId: 'second', height: 48 },
      { toastId: 'first', height: 40 },
    ]);
    expect(toastState.heights.map((height) => height.toastId)).toEqual(
      toastState.toasts.map((toast) => toast.id),
    );
  });

  it('updates an existing entry in place and stays compact', () => {
    toastState.create({ id: 'first', message: 'First' });
    toastState.create({ id: 'second', message: 'Second' });

    toastState.setHeight({ toastId: 'first', height: 40 });
    expect(toastState.heights).toEqual([{ toastId: 'first', height: 40 }]);

    toastState.setHeight({ toastId: 'first', height: 40 });
    expect(toastState.heights).toEqual([{ toastId: 'first', height: 40 }]);

    toastState.setHeight({ toastId: 'first', height: 48 });
    expect(toastState.heights).toEqual([{ toastId: 'first', height: 48 }]);
    toastState.removeHeight('first');

    expect(toastState.heights).toEqual([]);
  });
});
