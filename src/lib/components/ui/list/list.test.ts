// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { parseUiComponentMetadata } from '../component-metadata';
import ListHarness from './ListHarness.svelte';
import { listFixtures } from './list.fixtures';
import { listMetadata } from './list.meta';

describe('List', () => {
  it('renders thin-bordered rows with soft selected and functional focus states', async () => {
    const { container, getByRole } = render(ListHarness);
    const list = container.querySelector('[data-slot="list-container"]');
    const selected = getByRole('button', { name: /A long list title/ });
    expect(list?.className).toContain('rounded-(--radius-medium)');
    expect(list?.className).toContain('border-border');
    expect(selected.className).toContain('focus-visible:border-ring');
    expect(selected.className).toContain('focus-visible:ring-2');
    expect(selected.className).toContain('bg-accent');
    expect(selected.querySelector('.type-body')).not.toBeNull();
    expect(selected.querySelector('.type-caption')).not.toBeNull();
    selected.focus();
    await fireEvent.keyDown(selected, { key: 'Enter' });
    expect(document.activeElement).toBe(selected);
  });

  it('preserves collapsible keyboard semantics and renders empty content as plain text', async () => {
    const { container, getByRole } = render(ListHarness);
    const toggle = getByRole('button', { name: 'Recent work' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    await fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    const empty = container.querySelector('[data-slot="list-empty"]');
    expect(empty?.textContent).toContain('No intentionally empty items');
    expect(empty?.className).not.toContain('border');
    expect(empty?.className).not.toContain('bg-');
    expect(empty?.className).not.toContain('list-empty-hatch');
    expect(empty?.querySelector('svg')).toBeNull();
  });

  it('publishes host-independent metadata and complete responsive fixtures', () => {
    expect(() => parseUiComponentMetadata(listMetadata)).not.toThrow();
    expect(listFixtures.flatMap(({ states }) => states)).toEqual(
      expect.arrayContaining([
        'selected',
        'active',
        'keyboard-focus',
        'empty-message',
        'long-content',
        'zoom-200',
      ]),
    );
  });
});
