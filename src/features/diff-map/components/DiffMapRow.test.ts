/**
 * @vitest-environment jsdom
 */
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DiffMapLayoutFileRow } from '../layout/layout-diff-map';
import type { DiffMapFile, DiffMapFileStatus } from '../model/types';
import DiffMapRow from './DiffMapRow.svelte';

afterEach(cleanup);

const row: DiffMapLayoutFileRow = {
  kind: 'file',
  fileId: 'src/file.ts',
  label: 'file.ts',
  x: 0,
  y: 0,
  w: 240,
  h: 28,
};

function renderRow(file: DiffMapFile, rung: 0 | 1 | 2 | 3 = 1) {
  return render(DiffMapRow, {
    props: {
      file,
      row: { ...row, fileId: file.id },
      blockX: 0,
      blockY: 0,
      rung,
      active: false,
      selected: false,
      focused: true,
      matchesFilter: true,
      onActivate: vi.fn(),
      onKeydown: vi.fn(),
      onFocus: vi.fn(),
    },
  });
}

function file(status: DiffMapFileStatus, overrides: Partial<DiffMapFile> = {}): DiffMapFile {
  return {
    id: `src/${status}.ts`,
    path: `src/${status}.ts`,
    name: `${status}.ts`,
    dir: 'src',
    status,
    additions: 3,
    deletions: 2,
    statsKnown: true,
    ...overrides,
  };
}

describe('DiffMapRow', () => {
  it.each([
    ['added', 'A', 'Added'],
    ['modified', 'M', 'Modified'],
    ['deleted', 'D', 'Deleted'],
    ['renamed', 'R→', 'Renamed'],
    ['binary', 'B', 'Binary'],
    ['mode', 'M', 'Mode changed'],
    ['unknown', '–', 'Unavailable'],
  ] as const)(
    'renders the %s status encoding and localized accessible status',
    (status, glyph, label) => {
      const { container } = renderRow(file(status));
      const button = container.querySelector<HTMLButtonElement>('[data-diff-map-row]')!;

      expect(button.dataset.status).toBe(status);
      expect(button.querySelector('[data-status-glyph]')?.textContent).toBe(glyph);
      expect(button.getAttribute('aria-label')).toContain(label);
    },
  );

  it('only describes supplemental rename, unavailable-stat, and track information', () => {
    const renamed = file('renamed', {
      renamedFrom: 'src/old-name.ts',
      statsKnown: false,
      additions: 0,
      deletions: 0,
      oldTrack: [0.1, 0.2],
      newTrack: [0.8, 0.1],
    });
    const { container } = renderRow(renamed, 0);
    const button = container.querySelector<HTMLButtonElement>('[data-diff-map-row]')!;
    const descriptions = button
      .getAttribute('aria-describedby')!
      .split(' ')
      .map((id) => container.querySelector(`#${id}`)?.textContent);

    expect(descriptions).toEqual([
      'Renamed from src/old-name.ts',
      'Change statistics unavailable',
      'Edit positions: old 10%; new 80%',
    ]);
    expect(button.querySelector('.tooltip')?.textContent).toContain('src/old-name.ts');
    expect(button.querySelector('.tooltip')?.textContent).toContain(
      'Change statistics unavailable',
    );

    cleanup();
    const ordinary = renderRow(file('modified')).container.querySelector('[data-diff-map-row]')!;
    expect(ordinary.hasAttribute('aria-describedby')).toBe(false);
  });

  it.each([
    [4, 0, ['+4']],
    [0, 7, ['−7']],
    [0, 0, []],
  ])('suppresses zero stat sides independently for +%i −%i', (additions, deletions, expected) => {
    const { container } = renderRow(file('modified', { additions, deletions }));
    const values = [...container.querySelectorAll('[data-stat-side]')].map(
      (node) => node.textContent,
    );
    expect(values).toEqual(expected);
  });

  it('keeps the unavailable label visible for unknown stats', () => {
    const { container } = renderRow(file('modified', { statsKnown: false }));
    expect(container.querySelector('.stats--unknown')?.textContent).toBe('Unavailable');
  });
});
