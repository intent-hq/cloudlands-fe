// @vitest-environment jsdom
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseUiComponentMetadata } from '../component-metadata';
import ListHarness from './ListHarness.svelte';
import ListItem from './ListItem.svelte';
import { listFixtures } from './list.fixtures';
import { listMetadata } from './list.meta';

afterEach(() => vi.restoreAllMocks());

function rect(top: number, height: number): DOMRect {
  return {
    x: 0,
    y: top,
    top,
    left: 0,
    right: 200,
    bottom: top + height,
    width: 200,
    height,
    toJSON: () => ({}),
  };
}

describe('List', () => {
  it('renders borderless selected rows with functional focus states', async () => {
    const { container, getByRole } = render(ListHarness);
    const list = container.querySelector('[data-slot="list-container"]');
    const selected = getByRole('button', { name: /A long list title/ });
    const active = getByRole('button', { name: /Active row/ });
    expect(list?.className).toContain('gap-px');
    expect(selected.className).toContain('rounded-md');
    expect(selected.className).toContain('border-transparent');
    expect(selected.className).toContain('justify-start');
    expect(selected.className).toContain('[&_[data-slot=button-content]]:w-full');
    expect(active.className).not.toContain('border-input');
    expect(active.className).not.toContain('shadow-');
    expect(selected.className).toContain('focus-visible:border-ring');
    expect(selected.className).toContain('focus-visible:ring-2');
    expect(selected.className).toContain('bg-selected');
    expect(selected.style.paddingLeft).toBe('8px');
    expect(selected.style.paddingRight).toBe('8px');
    expect(selected.style.marginLeft).toBe('');
    expect(selected.style.width).toBe('');
    expect(selected.querySelector('.type-body')).not.toBeNull();
    expect(selected.querySelector('.type-caption')).not.toBeNull();
    selected.focus();
    await fireEvent.keyDown(selected, { key: 'Enter' });
    expect(document.activeElement).toBe(selected);
  });

  it('keeps nested row highlights full-width while indenting their content', () => {
    const { getByRole } = render(ListItem, {
      props: { title: 'Nested row', selected: true, indent: 2 },
    });
    const nested = getByRole('button', { name: 'Nested row' });

    expect(nested.style.paddingLeft).toBe('52px');
    expect(nested.style.paddingRight).toBe('8px');
    expect(nested.style.marginLeft).toBe('');
    expect(nested.style.width).toBe('');
  });

  it('previews the nearest enabled row and shares that state with keyboard focus', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      if (this.getAttribute('data-slot') === 'list-container') return rect(0, 96);
      if (this.textContent?.includes('Active row')) return rect(32, 32);
      if (this.textContent?.includes('Disabled row')) return rect(64, 32);
      return rect(0, 32);
    });
    const { container, getByRole } = render(ListHarness);
    const list = container.querySelector<HTMLElement>('[data-slot="list-container"]');
    const selected = getByRole('button', { name: /A long list title/ });
    const active = getByRole('button', { name: /Active row/ });
    expect(list?.getAttribute('data-interactive')).toBe('true');

    await fireEvent.pointerMove(list!, { clientX: 10, clientY: 48 });
    await waitFor(() => expect(active.getAttribute('data-proximity-active')).toBe('true'));
    selected.focus();
    await waitFor(() => {
      expect(selected.getAttribute('data-proximity-active')).toBe('true');
      expect(active.getAttribute('data-proximity-active')).toBeNull();
    });
  });

  it('preserves collapsible keyboard semantics and renders empty content as plain text', async () => {
    const { container, getByRole } = render(ListHarness);
    const toggle = getByRole('button', { name: 'Recent work' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.className).toContain('[&_[data-slot=button-content]]:w-full');
    await fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.querySelector('svg')?.classList.contains('-rotate-90')).toBe(true);
    const empty = container.querySelector('[data-slot="list-empty"]');
    expect(empty?.textContent).toContain('No intentionally empty items');
    expect(empty?.className).not.toContain('border');
    expect(empty?.className).not.toContain('bg-');
    expect(empty?.className).not.toContain('list-empty-hatch');
    expect(empty?.querySelector('svg')).toBeNull();
  });

  it('uses the shared intent mark for a loading row and keeps mixed-size text baseline aligned', () => {
    const { container, getByRole } = render(ListHarness);
    const loading = getByRole('button', { name: /Loading row/ });
    const selected = getByRole('button', { name: /A long list title/ });
    const loader = loading.querySelector('[data-slot="intent-mark-loader"]');
    expect(loader).not.toBeNull();
    expect(loader?.getAttribute('width')).toBe('14');
    expect(selected.querySelector('.items-baseline')).not.toBeNull();
    expect(container.querySelector('[data-slot="list-section-content"]')?.className).toContain(
      'text-left',
    );
  });

  it('publishes host-independent metadata and complete responsive fixtures', () => {
    expect(() => parseUiComponentMetadata(listMetadata)).not.toThrow();
    expect(listFixtures.flatMap(({ states }) => states)).toEqual(
      expect.arrayContaining([
        'selected',
        'active',
        'keyboard-focus',
        'proximity-hover',
        'empty-message',
        'long-content',
        'zoom-200',
      ]),
    );
  });
});
