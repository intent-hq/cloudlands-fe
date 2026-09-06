/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DiffMapLayoutRow } from '../layout/layout-diff-map';
import type { DiffMapFile, DiffMapFileStatus } from '../model/types';
import DiffMapRail from './DiffMapRail.svelte';

afterEach(cleanup);

function file(id: string, status: DiffMapFileStatus): DiffMapFile {
  return {
    id,
    path: id,
    name: id,
    dir: '',
    status,
    additions: 1,
    deletions: 0,
    statsKnown: true,
  };
}

function row(fileId: string, y: number): DiffMapLayoutRow {
  return { fileId, label: fileId, x: 0, y, w: 100, h: 10 };
}

describe('DiffMapRail', () => {
  it('clusters files into status-dominant buckets and caps their count', () => {
    const rows = Array.from({ length: 60 }, (_, index) => row(`file-${index}`, index * 20));
    const files = new Map(
      rows.map(({ fileId }, index) => [
        fileId,
        file(fileId, index % 3 === 0 ? 'deleted' : 'added'),
      ]),
    );
    const { container } = render(DiffMapRail, {
      props: {
        rows,
        files,
        contentHeight: 1200,
        viewportHeight: 500,
        viewportWidth: 900,
        scrollTop: 0,
        selected: new Set(),
        onJump: vi.fn(),
      },
    });

    const buckets = container.querySelectorAll('[data-rail-bucket]');
    expect(buckets.length).toBeGreaterThan(1);
    expect(buckets.length).toBeLessThanOrEqual(24);
    expect([...buckets].some((bucket) => bucket.getAttribute('data-status') === 'added')).toBe(
      true,
    );
    expect(screen.getByRole('button', { name: '0 files above, 35 files below' })).toBeTruthy();
  });

  it('reports files above and below, keeps narrow width, and preserves click-to-jump', async () => {
    const rows = [row('added-1', 100), row('added-2', 101), row('deleted-1', 102)];
    const files = new Map([
      ['added-1', file('added-1', 'added')],
      ['added-2', file('added-2', 'added')],
      ['deleted-1', file('deleted-1', 'deleted')],
    ]);
    const onJump = vi.fn();
    const { container } = render(DiffMapRail, {
      props: {
        rows,
        files,
        contentHeight: 1000,
        viewportHeight: 240,
        viewportWidth: 280,
        scrollTop: 80,
        selected: new Set(),
        onJump,
      },
    });
    const rail = screen.getByRole('button', { name: /files above.*files below/i });
    expect(rail.style.width).toBe('8px');
    expect(container.querySelectorAll('[data-rail-bucket]')).toHaveLength(1);
    expect(container.querySelector('[data-rail-bucket]')?.getAttribute('data-status')).toBe(
      'added',
    );
    vi.spyOn(rail, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      right: 8,
      bottom: 200,
      left: 0,
      width: 8,
      height: 200,
      toJSON: () => ({}),
    });

    await fireEvent.click(rail, { clientY: 100 });
    expect(onJump).toHaveBeenCalledWith(380);
  });

  it('does not render without overflow', () => {
    render(DiffMapRail, {
      props: {
        rows: [row('file-1', 0)],
        files: new Map([['file-1', file('file-1', 'modified')]]),
        contentHeight: 240,
        viewportHeight: 240,
        viewportWidth: 900,
        scrollTop: 0,
        selected: new Set(),
        onJump: vi.fn(),
      },
    });

    expect(screen.queryByRole('button')).toBeNull();
  });
});
