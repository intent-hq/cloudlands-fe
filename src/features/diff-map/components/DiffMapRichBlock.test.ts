/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tinyDiffMapFixture } from '../model/fixtures';
import type { DiffMapDocument } from '../model/types';
import DiffMapRichBlock from './DiffMapRichBlock.svelte';

afterEach(cleanup);

function annotatedDocument(): DiffMapDocument {
  const [first, second, third] = tinyDiffMapFixture.document.files;
  return {
    ...tinyDiffMapFixture.document,
    annotations: [
      {
        id: 'claim-alpha',
        kind: 'claim',
        label: 'Claim alpha',
        paths: [first.path, second.path],
        provenance: 'test',
      },
      {
        id: 'claim-beta',
        kind: 'claim',
        label: 'Claim beta',
        paths: [second.path, third.path],
        provenance: 'test',
      },
      {
        id: 'group-first',
        kind: 'group',
        label: 'First file only',
        paths: [first.path],
      },
    ],
  };
}

function mapRows(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLButtonElement>('[data-diff-map-row]')];
}

function selectedPaths(container: HTMLElement) {
  return mapRows(container)
    .filter((row) => row.getAttribute('aria-pressed') === 'true')
    .map((row) => row.dataset.fileId);
}

describe('DiffMapRichBlock', () => {
  it('opens once for the browser double-click event sequence', async () => {
    const onOpen = vi.fn();
    const { container } = render(DiffMapRichBlock, {
      props: { document: annotatedDocument(), onOpen },
    });
    await waitFor(() => expect(mapRows(container)).toHaveLength(3));
    const row = mapRows(container)[0];

    await fireEvent.click(row, { detail: 1 });
    await fireEvent.click(row, { detail: 2 });
    await fireEvent.dblClick(row, { detail: 2 });
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('unions enabled claims and removes only the toggled-off claim paths', async () => {
    const { container } = render(DiffMapRichBlock, {
      props: { document: annotatedDocument(), onOpen: vi.fn() },
    });
    await waitFor(() => expect(mapRows(container)).toHaveLength(3));

    await fireEvent.click(screen.getByRole('button', { name: 'Claim alpha' }));
    expect(selectedPaths(container)).toEqual(['src/index.ts', 'src/lib/format.ts']);

    await fireEvent.click(screen.getByRole('button', { name: 'Claim beta' }));
    expect(selectedPaths(container)).toEqual([
      'src/index.ts',
      'src/lib/format.ts',
      'tests/format.test.ts',
    ]);

    await fireEvent.click(screen.getByRole('button', { name: 'Claim alpha' }));
    expect(selectedPaths(container)).toEqual(['src/lib/format.ts', 'tests/format.test.ts']);
  });

  it('clears the active group filter when its chip is toggled off', async () => {
    const { container } = render(DiffMapRichBlock, {
      props: { document: annotatedDocument(), onOpen: vi.fn() },
    });
    await waitFor(() => expect(mapRows(container)).toHaveLength(3));
    const group = screen.getByRole('button', { name: 'First file only' });

    await fireEvent.click(group);
    expect(group.getAttribute('aria-pressed')).toBe('true');
    expect(mapRows(container).map((row) => row.style.opacity)).toEqual(['1', '0.28', '0.28']);

    await fireEvent.click(group);
    expect(group.getAttribute('aria-pressed')).toBe('false');
    expect(mapRows(container).map((row) => row.style.opacity)).toEqual(['1', '1', '1']);
  });
});
