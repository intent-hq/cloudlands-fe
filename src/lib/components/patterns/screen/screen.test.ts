// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ScreenHarness from './ScreenHarness.svelte';
import { screenFixtures } from './screen.fixtures';
import { screenMetadata } from './screen.meta';
import * as screenApi from './index';

afterEach(cleanup);

describe('screen pattern', () => {
  it('composes a stable header, body, and FormActions footer', () => {
    const { container } = render(ScreenHarness);
    const root = container.querySelector('[data-slot="screen"]')!;

    expect(root.querySelector('[data-slot="screen-header"]')).toBeTruthy();
    expect(root.querySelector('[data-slot="screen-body"]')).toBeTruthy();
    expect(
      root.querySelector('[data-slot="screen-footer"] [data-slot="form-actions"]'),
    ).toBeTruthy();
  });

  it('keeps takeover actions outside its animated body region', () => {
    const { container } = render(ScreenHarness, { state: 'takeover' });
    const body = container.querySelector('[data-slot="takeover-screen-body"]')!;
    const footer = container.querySelector('[data-slot="screen-footer"]')!;

    expect(screen.getByText('2 of 3')).toBeTruthy();
    expect(body.contains(footer)).toBe(false);
    expect(container.querySelector('[data-slot="takeover-screen"]')).toBeTruthy();
  });

  it('renders actionable empty and disclosed error states', async () => {
    const onRetry = vi.fn();
    const empty = render(ScreenHarness, { state: 'empty' });
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy();
    expect(empty.container.querySelector('[data-slot="empty-state-title"]')).toBeNull();
    expect(empty.container.querySelector('[data-slot="empty-state-description"]')).toBeTruthy();
    empty.unmount();

    const failed = render(ScreenHarness, { state: 'error', onRetry });
    const errorState = failed.container.querySelector('[data-state-kind="error"]');
    expect(errorState?.getAttribute('data-severity')).toBe('routine');
    expect(errorState?.querySelector('[data-slot="empty-state-title"]')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
    await fireEvent.click(screen.getByText('Details'));
    expect(screen.getByText('Error details')).toBeTruthy();
  });

  it('reserves danger severity for an explicit error state', () => {
    const { container } = render(ScreenHarness, { state: 'error-danger' });
    expect(
      container.querySelector('[data-state-kind="error"]')?.getAttribute('data-severity'),
    ).toBe('danger');
  });

  it('provides list, card-grid, and form loading fixture recipes', () => {
    const { container } = render(ScreenHarness, { state: 'loading' });
    expect(screen.getByRole('status', { name: 'Loading screen' })).toBeTruthy();
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(4);
    expect(screenFixtures.flatMap((fixture) => fixture.states)).toEqual(
      expect.arrayContaining(['error-danger', 'loading-list', 'loading-card-grid', 'loading-form']),
    );
  });

  it('publishes complete metadata and its public API', () => {
    expect(Object.keys(screenApi).sort()).toEqual([...screenMetadata.exports].sort());
    expect(screenMetadata.replaces).not.toHaveLength(0);
  });
});
