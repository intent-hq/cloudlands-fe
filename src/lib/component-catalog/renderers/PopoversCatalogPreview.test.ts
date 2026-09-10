/**
 * @vitest-environment jsdom
 */
import { cleanup, render, waitFor } from '@testing-library/svelte';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCatalogEntry } from '../catalog';
import PopoversCatalogPreview from './PopoversCatalogPreview.svelte';

const originalScrollIntoView = Element.prototype.scrollIntoView;

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  Element.prototype.scrollIntoView = originalScrollIntoView;
  document.body.removeAttribute('style');
});

describe('PopoversCatalogPreview', () => {
  it('renders static overlays without locking the page and preserves overlay semantics', async () => {
    const fixture = getCatalogEntry('popovers')?.fixtures[0];
    if (!fixture) throw new Error('Missing popovers catalog fixture');

    const { container } = render(PopoversCatalogPreview, { props: { fixture } });

    await waitFor(() => {
      expect(container.querySelectorAll('[data-static-position]')).toHaveLength(16);
      expect(getComputedStyle(document.body).overflow).not.toBe('hidden');
      expect(getComputedStyle(document.body).pointerEvents).not.toBe('none');
    });

    expect(container.querySelectorAll('[role="menu"]')).not.toHaveLength(0);
    expect(container.querySelectorAll('[role="listbox"]')).not.toHaveLength(0);

    const result = await axe.run(container, {
      runOnly: {
        type: 'rule',
        values: ['aria-required-children', 'aria-required-parent', 'scrollable-region-focusable'],
      },
    });
    expect(result.violations).toEqual([]);
  });
});
