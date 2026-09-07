/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DiffMapLayoutFileRow } from '../layout/layout-diff-map';
import type { DiffMapFile, DiffMapFileStatus } from '../model/types';
import DiffMapRail from './DiffMapRail.svelte';

afterEach(cleanup);

function file(id: string, status: DiffMapFileStatus, path = id): DiffMapFile {
  return {
    id,
    path,
    name: path,
    dir: '',
    status,
    additions: 1,
    deletions: 0,
    statsKnown: true,
  };
}

function row(fileId: string, y: number): DiffMapLayoutFileRow {
  return { kind: 'file', fileId, label: fileId, x: 0, y, w: 100, h: 10 };
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
        controlsId: 'viewport',
        onJump: vi.fn(),
      },
    });

    const buckets = container.querySelectorAll('[data-rail-bucket]');
    expect(buckets.length).toBeGreaterThan(1);
    expect(buckets.length).toBeLessThanOrEqual(24);
    expect([...buckets].some((bucket) => bucket.getAttribute('data-status') === 'added')).toBe(
      true,
    );
    expect(screen.getByRole('scrollbar', { name: '0 files above, 35 files below' })).toBeTruthy();
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
        controlsId: 'viewport',
        onJump,
      },
    });
    const rail = screen.getByRole('scrollbar', { name: /files above.*files below/i });
    expect(rail.style.width).toBe('8px');
    expect(rail.getAttribute('aria-controls')).toBe('viewport');
    expect(rail.getAttribute('aria-valuenow')).toBe('80');
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

  it('moves by bucket, viewport, and extremes from the keyboard', async () => {
    const rows = [row('file-1', 100), row('file-2', 350), row('file-3', 600), row('file-4', 850)];
    const files = new Map(rows.map(({ fileId }) => [fileId, file(fileId, 'modified')]));
    const onJump = vi.fn();
    render(DiffMapRail, {
      props: {
        rows,
        files,
        contentHeight: 1000,
        viewportHeight: 240,
        viewportWidth: 900,
        scrollTop: 100,
        selected: new Set(),
        controlsId: 'map-viewport',
        onJump,
      },
    });
    const rail = screen.getByRole('scrollbar');
    expect(rail.getAttribute('aria-valuemin')).toBe('0');
    expect(rail.getAttribute('aria-valuemax')).toBe('760');
    expect(rail.getAttribute('aria-valuenow')).toBe('100');

    for (const [key, target] of [
      ['ArrowDown', 350],
      ['ArrowUp', 0],
      ['PageDown', 340],
      ['PageUp', 0],
      ['Home', 0],
      ['End', 760],
    ] as const) {
      await fireEvent.keyDown(rail, { key });
      expect(onJump).toHaveBeenLastCalledWith(target);
    }
  });

  it('updates active and selected buckets with the viewport window', async () => {
    const rows = [row('one', 100), row('two', 350), row('three', 600), row('four', 850)];
    const files = new Map([
      ['one', file('one', 'modified', 'src/one.ts')],
      ['two', file('two', 'added', 'src/two.ts')],
      ['three', file('three', 'deleted', 'src/three.ts')],
      ['four', file('four', 'renamed', 'src/four.ts')],
    ]);
    const view = render(DiffMapRail, {
      props: {
        rows,
        files,
        contentHeight: 1000,
        viewportHeight: 240,
        viewportWidth: 900,
        scrollTop: 80,
        activePath: 'src/two.ts',
        selected: new Set(['src/three.ts']),
        controlsId: 'viewport',
        onJump: vi.fn(),
      },
    });

    expect(view.container.querySelector('.tick--active')?.getAttribute('data-status')).toBe(
      'added',
    );
    expect(view.container.querySelector('.tick--selected')?.getAttribute('data-status')).toBe(
      'deleted',
    );
    expect((view.container.querySelector('.viewport-window') as HTMLElement).style.top).toBe('8%');

    await view.rerender({
      rows,
      files,
      contentHeight: 1000,
      viewportHeight: 240,
      viewportWidth: 900,
      scrollTop: 400,
      activePath: 'src/four.ts',
      selected: new Set(['src/one.ts']),
      controlsId: 'viewport',
      onJump: vi.fn(),
    });
    expect(view.container.querySelector('.tick--active')?.getAttribute('data-status')).toBe(
      'renamed',
    );
    expect(view.container.querySelector('.tick--selected')?.getAttribute('data-status')).toBe(
      'modified',
    );
    expect((view.container.querySelector('.viewport-window') as HTMLElement).style.top).toBe('40%');
    expect(screen.getByRole('scrollbar').getAttribute('aria-valuenow')).toBe('400');
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
        controlsId: 'viewport',
        onJump: vi.fn(),
      },
    });

    expect(screen.queryByRole('scrollbar')).toBeNull();
  });
});
