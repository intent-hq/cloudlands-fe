import {
  cleanup,
  render,
  screen,
  waitFor,
} from '@testing-library/svelte';
import {
  afterEach,
  describe,
  expect,
  expectTypeOf,
  it,
} from 'vitest';
import type { Readable } from 'svelte/store';
import ReadablePropHarness from './ReadablePropHarness.test.svelte';
import { readableProp } from './svelte-context';

describe('readableProp', () => {
  afterEach(() => {
    cleanup();
  });

  it('returns a typed readable store', () => {
    const value$ = readableProp(() => 'workspace-1');

    expectTypeOf(value$).toEqualTypeOf<Readable<string>>();
    expect(typeof value$.subscribe).toBe('function');
  });

  it('updates when the source prop changes', async () => {
    const { rerender } = render(ReadablePropHarness, {
      props: { value: 'workspace-1' },
    });

    expect(screen.getByTestId('value').textContent).toBe('workspace-1');

    await rerender({ value: 'workspace-2' });

    await waitFor(() => {
      expect(screen.getByTestId('value').textContent).toBe('workspace-2');
    });
  });
});