/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('svelte-fa', async () => ({
  default: (await import('$lib/components/ui/__tests__/mocks/Fa.svelte')).default,
}));

import ResourceIconTile from './ResourceIconTile.svelte';

describe('ResourceIconTile', () => {
  afterEach(cleanup);

  it.each([
    ['note', 'align-left'],
    ['changes', 'code'],
  ] as const)('renders the shared %s identity glyph', (kind, iconName) => {
    const { container } = render(ResourceIconTile, { props: { kind } });
    const tile = container.querySelector<HTMLElement>('[data-resource-icon-tile]')!;

    expect(tile.dataset.resourceKind).toBe(kind);
    expect(tile.getAttribute('aria-hidden')).toBe('true');
    expect(tile.querySelector('[data-resource-icon-glyph]')).toBeTruthy();
    expect(tile.querySelector('[data-icon]')?.getAttribute('data-icon')).toBe(iconName);
  });
});
