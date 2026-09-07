/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import {
  diffMapFixtures,
  hugeDiffMapFixture,
  overflowDiffMapFixture,
  tinyDiffMapFixture,
  typicalDiffMapFixture,
} from '../model/fixtures';
import { buildDiffMapDocument } from '../model/build-document';
import type { ChatFileChange } from '$lib/utils/get-file-changes-from-messages';
import { fromPullRequest } from '../sources';
import DiffMap from './DiffMap.svelte';

const scrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'scrollIntoView',
);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (scrollIntoViewDescriptor) {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', scrollIntoViewDescriptor);
  } else {
    delete (HTMLElement.prototype as { scrollIntoView?: Element['scrollIntoView'] }).scrollIntoView;
  }
});

function rows(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLButtonElement>('[data-diff-map-row]')];
}

function installScrollIntoViewSpy() {
  const spy = vi.fn();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: spy,
  });
  return spy;
}

function installResizeObserver() {
  let callback: ResizeObserverCallback | undefined;
  const observer = {
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  };
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(next: ResizeObserverCallback) {
        callback = next;
      }
      observe = observer.observe;
      unobserve = observer.unobserve;
      disconnect = observer.disconnect;
    },
  );
  return async (width: number, height: number) => {
    if (!callback) throw new Error('ResizeObserver was not installed');
    callback(
      [{ contentRect: { width, height } } as ResizeObserverEntry],
      observer as unknown as ResizeObserver,
    );
    await tick();
    await tick();
  };
}

async function flushLayout() {
  await tick();
  await tick();
}

describe('DiffMap', () => {
  it.each([
    ['renamed', 'daemon'],
    ['R', 'porcelain'],
  ])('renders a %s %s chat change with the rename glyph', async (status, sourceKind) => {
    const change: ChatFileChange = {
      filePath: `src/${sourceKind}-renamed.ts`,
      action: 'modify',
      status,
      additions: 0,
      deletions: 0,
      toolName: 'local',
      toolCallId: `${sourceKind}-rename`,
    };
    const document = buildDiffMapDocument([change], {
      source: { kind: 'working-tree', workspaceId: 'ws-1', snapshotId: sourceKind },
    });
    const { container } = render(DiffMap, { props: { document, rungOverride: 1 } });

    await waitFor(() => expect(rows(container)).toHaveLength(1));
    expect(rows(container)[0].dataset.status).toBe('renamed');
    expect(rows(container)[0].textContent).toContain('R→');
  });

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

  it('names directory groups by full path and exposes section and block headings', async () => {
    const { container } = render(DiffMap, {
      props: { document: typicalDiffMapFixture.document, onOpen: vi.fn() },
    });

    await waitFor(() => expect(rows(container)).toHaveLength(24));
    const firstGroup = typicalDiffMapFixture.document.groups[0];
    expect(screen.getByRole('group', { name: firstGroup.path })).toBeTruthy();
    expect(screen.getByRole('heading', { name: firstGroup.path })).toBeTruthy();
    for (const section of typicalDiffMapFixture.document.sections ?? []) {
      expect(screen.getByRole('heading', { name: section.displayName, exact: true })).toBeTruthy();
    }
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

  it('moves across columns and blocks in an overflowing map with roving focus', async () => {
    const triggerResize = installResizeObserver();
    const scrollIntoView = installScrollIntoViewSpy();
    const { container } = render(DiffMap, {
      props: {
        document: typicalDiffMapFixture.document,
        rungOverride: 3,
        onOpen: vi.fn(),
      },
    });

    await waitFor(() => expect(rows(container)).toHaveLength(24));
    await triggerResize(900, 120);
    expect(screen.getByRole('scrollbar')).toBeTruthy();
    const firstGroup = container.querySelector<HTMLElement>(
      `[data-group-id="${typicalDiffMapFixture.document.groups[0].id}"]`,
    );
    if (!firstGroup) throw new Error('Expected first diff map group');
    const groupRows = rows(firstGroup);
    const columnBoundary = groupRows.findIndex(
      (row, index) => index > 0 && row.style.left !== groupRows[index - 1].style.left,
    );
    expect(columnBoundary).toBeGreaterThan(0);

    groupRows[columnBoundary - 1].focus();
    await fireEvent.keyDown(groupRows[columnBoundary - 1], { key: 'ArrowRight' });
    await waitFor(() => expect(document.activeElement).toBe(groupRows[columnBoundary]));
    expect(rows(container).filter((row) => row.tabIndex === 0)).toEqual([
      groupRows[columnBoundary],
    ]);
    await fireEvent.keyDown(groupRows[columnBoundary], { key: 'ArrowLeft' });
    await waitFor(() => expect(document.activeElement).toBe(groupRows[columnBoundary - 1]));

    const allRows = rows(container);
    const lastInFirstGroup = groupRows.at(-1);
    if (!lastInFirstGroup) throw new Error('Expected a row in the first diff map group');
    const firstInSecondGroup = allRows[allRows.indexOf(lastInFirstGroup) + 1];
    lastInFirstGroup.focus();
    await fireEvent.keyDown(lastInFirstGroup, { key: 'ArrowDown' });
    await waitFor(() => expect(document.activeElement).toBe(firstInSecondGroup));
    expect(rows(container).filter((row) => row.tabIndex === 0)).toEqual([firstInSecondGroup]);
    await fireEvent.keyDown(firstInSecondGroup, { key: 'ArrowUp' });
    await waitFor(() => expect(document.activeElement).toBe(lastInFirstGroup));
    expect(scrollIntoView).toHaveBeenCalledTimes(4);
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
    if (!viewedRow) throw new Error('Expected viewed diff map row');
    const status = viewedRow.querySelector('.status');
    const overlay = viewedRow.querySelector('.overlay');
    if (!status || !overlay) throw new Error('Expected row status and overlay');
    expect(viewedRow.dataset.viewedState).toBe('viewed');
    expect(viewedRow.getAttribute('aria-label')?.toLocaleLowerCase()).toContain('modified');
    expect(viewedRow.getAttribute('aria-label')).toContain('Viewed');
    expect(getComputedStyle(status).gridColumn).toBe('1');
    expect(getComputedStyle(overlay).gridColumn).toBe('3');
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
    const countElement = screen.getByRole('heading', { name: /files changed/i });
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
      if (!matching || !dimmed) throw new Error('Expected matching and dimmed rows');
      expect(getComputedStyle(matching).opacity).toBe('1');
      expect(getComputedStyle(dimmed).opacity).toBe('0.28');
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

  it('returns focus to the restored more row when collapsing hides the focused file', async () => {
    const { container } = render(DiffMap, {
      props: { document: overflowDiffMapFixture.document, onOpen: vi.fn() },
    });
    await fireEvent.click(await screen.findByRole('button', { name: '+15 more' }));
    await waitFor(() => expect(rows(container)).toHaveLength(25));
    rows(container)[10].focus();

    await fireEvent.click(screen.getByRole('button', { name: 'Show less' }));
    await waitFor(() => expect(rows(container)).toHaveLength(10));
    const more = screen.getByRole('button', { name: '+15 more' });
    await waitFor(() => expect(document.activeElement).toBe(more));
    expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(rows(container).filter((row) => row.tabIndex === 0)).toEqual([rows(container)[9]]);
  });

  it('moves the active marker when activePath changes', async () => {
    const first = tinyDiffMapFixture.document.files[0].path;
    const second = tinyDiffMapFixture.document.files[1].path;
    const view = render(DiffMap, {
      props: { document: tinyDiffMapFixture.document, activePath: first, onOpen: vi.fn() },
    });
    await waitFor(() => expect(rows(view.container)).toHaveLength(3));
    expect(view.container.querySelectorAll('.diff-map-row--active')).toHaveLength(1);
    expect(
      view.container.querySelector('.diff-map-row--active')?.getAttribute('data-file-id'),
    ).toBe(first);

    await view.rerender({
      document: tinyDiffMapFixture.document,
      activePath: second,
      onOpen: vi.fn(),
    });
    expect(view.container.querySelectorAll('.diff-map-row--active')).toHaveLength(1);
    expect(
      view.container.querySelector('.diff-map-row--active')?.getAttribute('data-file-id'),
    ).toBe(second);
  });

  it('animates the existing block and row targets after expansion', async () => {
    const animate = vi.spyOn(Element.prototype, 'animate').mockReturnValue({} as Animation);
    const { container } = render(DiffMap, {
      props: { document: overflowDiffMapFixture.document, onOpen: vi.fn() },
    });
    await waitFor(() => expect(rows(container)).toHaveLength(10));
    const block = container.querySelector('[data-group-id]');
    if (!block) throw new Error('Expected diff map block');
    const existingRows = rows(container);

    await fireEvent.click(screen.getByRole('button', { name: '+15 more' }));
    await waitFor(() => expect(rows(container)).toHaveLength(25));
    await flushLayout();
    const targets = new Set(animate.mock.instances);
    expect(targets.has(block)).toBe(true);
    expect(existingRows.every((row) => targets.has(row))).toBe(true);
    expect(targets.size).toBe(existingRows.length + 1);
  });

  it('relayouts after cumulative sub-threshold ResizeObserver changes', async () => {
    const triggerResize = installResizeObserver();
    const animate = vi.spyOn(Element.prototype, 'animate').mockReturnValue({} as Animation);
    const { container } = render(DiffMap, {
      props: {
        document: typicalDiffMapFixture.document,
        rungOverride: 3,
        onOpen: vi.fn(),
      },
    });
    await waitFor(() => expect(rows(container)).toHaveLength(24));
    await triggerResize(800, 500);
    animate.mockClear();

    await triggerResize(790, 500);
    await triggerResize(780, 500);
    expect(animate).not.toHaveBeenCalled();
    await triggerResize(770, 500);
    expect(animate).toHaveBeenCalled();
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
    expect(
      await screen.findByRole('scrollbar', { name: /files above.*files below/i }),
    ).toBeTruthy();
  });
});
