// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import SizeContextHarness from './SizeContextHarness.svelte';

afterEach(cleanup);

describe('size context', () => {
  it('uses the default size, inherits a provider, and lets a nested provider override it', () => {
    render(SizeContextHarness);

    expect(screen.getByTestId('unscoped-size').textContent).toBe('default');
    expect(screen.getByTestId('compact-size').textContent).toBe('compact');
    expect(screen.getByTestId('nested-size').textContent).toBe('default');
  });
});
