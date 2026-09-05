// @vitest-environment jsdom
import { fireEvent, render, waitFor, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CollectionHarness from './CollectionHarness.svelte';
import CollectionStateHarness from './CollectionStateHarness.svelte';
import { collectionFixtures } from './collection.fixtures';
import { collectionMetadata } from './collection.meta';
import { parsePatternMetadata } from '../pattern-metadata';

afterEach(() => vi.restoreAllMocks());

function rect(top: number): DOMRect {
  return {
    x: 0,
    y: top,
    top,
    left: 0,
    right: 240,
    bottom: top + 48,
    width: 240,
    height: 48,
    toJSON: () => ({}),
  };
}

describe('collection pattern', () => {
  it('merges contiguous selections and toggles selection by keyboard', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      const index = Number(this.getAttribute('data-list-index') ?? 0);
      return rect(index * 48);
    });
    const { container } = render(CollectionHarness);
    const list = within(container).getByRole('listbox', { name: 'Test collection' });
    const options = within(list).getAllByRole('option');

    await waitFor(() => expect(container.querySelectorAll('.bg-selected')).toHaveLength(1));
    expect(options[1].getAttribute('aria-selected')).toBe('true');
    expect(options[2].getAttribute('aria-selected')).toBe('true');

    options[1].focus();
    await fireEvent.keyDown(options[1], { key: ' ' });
    expect(options[1].getAttribute('aria-selected')).toBe('false');
    expect(options[2].getAttribute('aria-selected')).toBe('true');
  });

  it('uses roving focus for arrows and typeahead', async () => {
    const { container } = render(CollectionHarness);
    const list = within(container).getByRole('listbox', { name: 'Test collection' });
    const options = within(list).getAllByRole('option');
    options[0].focus();

    await fireEvent.keyDown(options[0], { key: 'ArrowDown' });
    await waitFor(() => expect(document.activeElement).toBe(options[1]));
    await fireEvent.keyDown(options[1], { key: 'b' });
    await waitFor(() => expect(document.activeElement).toBe(options[2]));
  });

  it('reveals row actions to focus without changing row selection', async () => {
    const { container } = render(CollectionHarness);
    const list = within(container).getByRole('listbox', { name: 'Test collection' });
    const first = within(list).getAllByRole('option')[0];
    const action = within(first).getByRole('button', { name: 'Act on Alpha' });
    const actions = first.querySelector('[data-slot="row-actions"]');

    action.focus();
    await waitFor(() => expect(actions?.getAttribute('data-revealed')).toBe('true'));
    await fireEvent.click(action);
    expect(within(container).getByRole('status', { name: 'Action count' }).textContent).toBe('1');
    expect(first.getAttribute('aria-selected')).toBe('false');
  });

  it('covers the required state fixtures', () => {
    expect(() => parsePatternMetadata(collectionMetadata)).not.toThrow();
    expect(collectionFixtures.flatMap(({ states }) => states)).toEqual(
      expect.arrayContaining(['empty', 'loading', 'error', 'virtualized', 'reduced-motion']),
    );
  });

  it('uses default states and virtualizes collections above the threshold', () => {
    const loading = render(CollectionStateHarness, { props: { status: 'loading' } });
    expect(within(loading.container).getByRole('status', { name: 'Loading' })).toBeTruthy();
    loading.unmount();

    const failed = render(CollectionStateHarness, { props: { status: 'error' } });
    expect(within(failed.container).getByRole('alert')).toBeTruthy();
    failed.unmount();

    const empty = render(CollectionStateHarness);
    expect(empty.container.textContent).toContain('No items');
    empty.unmount();

    const virtualized = render(CollectionStateHarness, { props: { count: 205 } });
    const list = virtualized.container.querySelector('[data-slot="list-view"]');
    expect(list?.getAttribute('data-virtualized')).toBe('true');
    expect(virtualized.container.querySelectorAll('[data-list-index]').length).toBeLessThan(205);
  });
});
