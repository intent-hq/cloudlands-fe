/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  diffMapFixtures,
  hugeDiffMapFixture,
  overflowDiffMapFixture,
  tinyDiffMapFixture,
  typicalDiffMapFixture,
} from '../model/fixtures';
import { fromPullRequest } from '../sources';
import DiffMap from './DiffMap.svelte';

afterEach(cleanup);

function rows(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLButtonElement>('[data-diff-map-row]')];
}

describe('DiffMap', () => {
  it('renders an added pull request file with its added status glyph', async () => {
    const document = fromPullRequest({
      repository: 'intent-hq/cloudlands-fe',
      number: 42,
      headSha: 'pr-head',
      files: [{ path: 'src/new-file.ts', additions: 4, deletions: 0, status: 'added' }],
    });
    const { container } = render(DiffMap, {
      props: { document, rungOverride: 1, onOpen: vi.fn() },
    });

    await waitFor(() => expect(rows(container)).toHaveLength(1));
    expect(rows(container)[0].dataset.status).toBe('added');
    expect(rows(container)[0].querySelector('.status')?.textContent).toBe('A');
  });

  it('opens a file from click and Enter with its full accessible path and stats', async () => {
    const onOpen = vi.fn();
    const { container } = render(DiffMap, {
      props: { document: tinyDiffMapFixture.document, onOpen },
    });

    await waitFor(() => expect(rows(container)).toHaveLength(3));
    const first = rows(container)[0];
    expect(first.getAttribute('aria-label')).toContain(tinyDiffMapFixture.document.files[0].path);
    expect(first.getAttribute('aria-label')).toContain('+4 −1');

    await fireEvent.click(first);
    expect(onOpen).toHaveBeenLastCalledWith(
      tinyDiffMapFixture.document.files[0],
      expect.any(MouseEvent),
    );

    await fireEvent.keyDown(first, { key: 'Enter' });
    expect(onOpen).toHaveBeenLastCalledWith(
      tinyDiffMapFixture.document.files[0],
      expect.any(KeyboardEvent),
    );
  });

  it('moves focus in reading order and extends selection with Shift+Arrow', async () => {
    const onSelectionChange = vi.fn();
    const { container } = render(DiffMap, {
      props: {
        document: tinyDiffMapFixture.document,
        onOpen: vi.fn(),
        onSelectionChange,
      },
    });

    await waitFor(() => expect(rows(container)).toHaveLength(3));
    const first = rows(container)[0];
    first.focus();
    await fireEvent.keyDown(first, { key: 'ArrowDown' });
    await waitFor(() => expect(document.activeElement).toBe(rows(container)[1]));

    await fireEvent.keyDown(rows(container)[1], { key: 'ArrowDown', shiftKey: true });
    await waitFor(() => expect(document.activeElement).toBe(rows(container)[2]));
    const selected = onSelectionChange.mock.lastCall?.[0] as Set<string>;
    expect([...selected]).toEqual([
      tinyDiffMapFixture.document.files[1].path,
      tinyDiffMapFixture.document.files[2].path,
    ]);
  });

  it('renders distinct viewed and changed-since-viewed row states', async () => {
    const first = tinyDiffMapFixture.document.files[0].path;
    const second = tinyDiffMapFixture.document.files[1].path;
    const { container } = render(DiffMap, {
      props: {
        document: tinyDiffMapFixture.document,
        onOpen: vi.fn(),
        layers: { viewed: new Set([first]), changedSinceViewed: new Set([second]) },
      },
    });

    await waitFor(() => expect(rows(container)).toHaveLength(3));
    const viewedRow = rows(container).find((row) => row.dataset.fileId === first);
    expect(viewedRow?.dataset.viewedState).toBe('viewed');
    expect(viewedRow?.getAttribute('aria-label')).toContain('modified');
    expect(viewedRow?.getAttribute('aria-label')).toContain('Viewed');
    expect(getComputedStyle(viewedRow!.querySelector('.status')!).gridColumn).toBe('1');
    expect(getComputedStyle(viewedRow!.querySelector('.overlay')!).gridColumn).toBe('3');
    expect(rows(container).find((row) => row.dataset.fileId === second)?.dataset.viewedState).toBe(
      'changed',
    );
  });

  it('focuses the filter with slash and dims non-matches without removing rows or count', async () => {
    const { container } = render(DiffMap, {
      props: { document: tinyDiffMapFixture.document, onOpen: vi.fn() },
    });

    await waitFor(() => expect(rows(container)).toHaveLength(3));
    const search = screen.getByRole('searchbox');
    const countElement = screen.getByRole('heading');
    const count = countElement?.textContent;
    rows(container)[0].focus();
    await fireEvent.keyDown(rows(container)[0], { key: '/' });
    expect(document.activeElement).toBe(search);

    await fireEvent.input(search, { target: { value: 'format' } });
    await waitFor(() => {
      expect(rows(container)).toHaveLength(3);
      expect(countElement?.textContent).toBe(count);
      const matching = rows(container).find((row) => row.dataset.fileId?.includes('format.ts'));
      const dimmed = rows(container).find((row) => row.dataset.fileId?.includes('index.ts'));
      expect(getComputedStyle(matching!).opacity).toBe('1');
      expect(getComputedStyle(dimmed!).opacity).toBe('0.28');
    });
  });

  it('omits meaningless zero stats from rename rows', async () => {
    const { container } = render(DiffMap, {
      props: {
        document: typicalDiffMapFixture.document,
        rungOverride: 1,
        onOpen: vi.fn(),
      },
    });

    await waitFor(() => expect(rows(container)).toHaveLength(24));
    const renamed = rows(container).find((row) => row.dataset.status === 'renamed');
    expect(renamed).toBeTruthy();
    expect(renamed?.textContent).not.toContain('+0');
    expect(renamed?.textContent).not.toContain('−0');
    expect(renamed?.getAttribute('aria-label')).not.toContain('+0 −0');
  });

  it('expands, collapses, and resets a capped directory block for a new snapshot', async () => {
    const onOpen = vi.fn();
    const view = render(DiffMap, {
      props: { document: overflowDiffMapFixture.document, onOpen },
    });

    await waitFor(() => expect(rows(view.container)).toHaveLength(10));
    const more = screen.getByRole('button', { name: '+15 more' });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    await fireEvent.click(more);
    await waitFor(() => expect(rows(view.container)).toHaveLength(25));
    expect(onOpen).not.toHaveBeenCalled();

    const less = screen.getByRole('button', { name: 'Show less' });
    expect(less.getAttribute('aria-expanded')).toBe('true');
    await fireEvent.click(less);
    await waitFor(() => expect(rows(view.container)).toHaveLength(10));

    await fireEvent.click(screen.getByRole('button', { name: '+15 more' }));
    await waitFor(() => expect(rows(view.container)).toHaveLength(25));
    await view.rerender({
      document: {
        ...overflowDiffMapFixture.document,
        source: { ...overflowDiffMapFixture.document.source, snapshotId: 'next-snapshot' },
      },
      onOpen,
    });
    await waitFor(() => expect(rows(view.container)).toHaveLength(10));
    expect(screen.getByRole('button', { name: '+15 more' })).toBeTruthy();
  });

  it('renders every fixture at every density rung and exposes an overflow rail', async () => {
    for (const fixture of diffMapFixtures) {
      for (const rungOverride of [0, 1, 2, 3] as const) {
        const view = render(DiffMap, {
          props: { document: fixture.document, rungOverride, onOpen: vi.fn(), filterable: false },
        });
        const visibleCount = fixture.document.groups.reduce(
          (count, group) => count + Math.min(10, group.fileIds.length),
          0,
        );
        await waitFor(() => expect(rows(view.container)).toHaveLength(visibleCount));
        view.unmount();
      }
    }

    render(DiffMap, {
      props: {
        document: hugeDiffMapFixture.document,
        rungOverride: 3,
        onOpen: vi.fn(),
        filterable: false,
      },
    });
    expect(await screen.findByRole('button', { name: /files above.*files below/i })).toBeTruthy();
  });
});
