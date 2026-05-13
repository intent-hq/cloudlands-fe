import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DiffViewer from './DiffViewer.svelte';

const testState = vi.hoisted(() => {
  function readable<T>(value: T) {
    return { subscribe: (subscriber: (value: T) => void) => (subscriber(value), () => {}) };
  }

  return { readable };
});

vi.mock('$lib/store/slices/user-preferences/user-preferences-selectors', () => ({
  selectCodeFontFamilyCSS: () => testState.readable('monospace'),
}));

vi.mock('$lib/store/slices/theme/theme-selectors', () => ({
  selectIsDarkTheme: () => testState.readable(false),
}));

vi.mock('$lib/utils/diff-highlighter-preloader', () => ({
  getDiffWorkerPool: () => undefined,
  getSafeDiffLanguage: (language?: string) => language ?? 'text',
}));

vi.mock('svelte-fa', async () => ({
  default: (await import('../__tests__/mocks/Fa.svelte')).default,
}));

vi.mock('@fortawesome/free-solid-svg-icons', () => ({
  faSearch: { iconName: 'search' },
  faXmark: { iconName: 'xmark' },
  faChevronUp: { iconName: 'chevron-up' },
  faChevronDown: { iconName: 'chevron-down' },
  faChevronRight: { iconName: 'chevron-right' },
  faFileCode: { iconName: 'file-code' },
  faPencil: { iconName: 'pencil' },
}));

vi.mock('@pierre/diffs', () => {
  class MockFileDiff {
    private containerWrapper?: HTMLElement;
    private renderCount = 0;

    render({ containerWrapper }: { containerWrapper?: HTMLElement }) {
      this.containerWrapper = containerWrapper;
      this.renderDiffDom();
    }

    private renderDiffDom() {
      if (!this.containerWrapper) return;
      const host = document.createElement('diffs-container');
      host.setAttribute('data-render-count', String(this.renderCount++));
      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = `
        <pre data-code>
          <div data-content>
            <div data-line data-line-index="1">repeat repeat</div>
            <div data-line data-line-index="2"><span>re</span><span>peat</span> again repeat</div>
          </div>
        </pre>
      `;
      this.containerWrapper.replaceChildren(host);
    }
    setOptions() {}
    setLineAnnotations() {}
    setThemeType() {}
    setSelectedLines() {}
    cleanUp() {}
    rerender() {
      this.renderDiffDom();
    }
    expandHunk() {}
  }

  return {
    FileDiff: MockFileDiff,
    VirtualizedFileDiff: MockFileDiff,
    parsePatchFiles: () => [{ files: [{ hunks: [], lang: 'text' }] }],
    parseDiffFromFile: () => ({ hunks: [], lang: 'text' }),
  };
});

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{ width: 10, height: 10 } as DOMRect]);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    top: 0,
    bottom: 10,
    left: 0,
    right: 10,
    width: 10,
    height: 10,
  } as DOMRect);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('DiffViewer search', () => {
  it('debounces non-empty input before walking and highlighting the diff DOM', async () => {
    vi.useFakeTimers();
    const { container } = render(DiffViewer, { props: { oldContent: '', newContent: 'repeat' } });

    await fireEvent.keyDown(container.querySelector('.pure-diff')!, { key: 'f', ctrlKey: true });
    await fireEvent.input(screen.getByPlaceholderText('Find in diff...'), { target: { value: 'repeat' } });
    await tick();

    const host = container.querySelector('diffs-container')!;
    expect(screen.queryByText('1 / 4')).toBeNull();
    expect(host.shadowRoot!.querySelectorAll('.diff-search-highlight')).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(149);
    await tick();
    expect(host.shadowRoot!.querySelectorAll('.diff-search-highlight')).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1);
    await tick();
    expect(screen.getByText('1 / 4')).toBeTruthy();
    expect(host.shadowRoot!.querySelectorAll('.diff-search-highlight')).toHaveLength(4);
  });

  it('counts every rendered match, including multiple matches in one line and split text nodes', async () => {
    const { container } = render(DiffViewer, { props: { oldContent: '', newContent: 'repeat' } });

    await fireEvent.keyDown(container.querySelector('.pure-diff')!, { key: 'f', ctrlKey: true });
    await fireEvent.input(screen.getByPlaceholderText('Find in diff...'), { target: { value: 'repeat' } });

    await waitFor(() => expect(screen.getByText('1 / 4')).toBeTruthy());
  });

  it('clears immediately and cancels pending searches when the query is emptied', async () => {
    vi.useFakeTimers();
    const { container } = render(DiffViewer, { props: { oldContent: '', newContent: 'repeat' } });

    await fireEvent.keyDown(container.querySelector('.pure-diff')!, { key: 'f', ctrlKey: true });
    const input = screen.getByPlaceholderText('Find in diff...');
    await fireEvent.input(input, { target: { value: 'repeat' } });
    await tick();
    await vi.advanceTimersByTimeAsync(150);
    await tick();

    const host = container.querySelector('diffs-container')!;
    expect(host.shadowRoot!.querySelectorAll('.diff-search-highlight')).toHaveLength(4);

    await fireEvent.input(input, { target: { value: '' } });
    await tick();

    expect(screen.queryByText('1 / 4')).toBeNull();
    expect(host.shadowRoot!.querySelectorAll('.diff-search-highlight')).toHaveLength(0);

    await vi.runOnlyPendingTimersAsync();
    await tick();
    expect(host.shadowRoot!.querySelectorAll('.diff-search-highlight')).toHaveLength(0);
  });

  it('refreshes highlights after a structural rerender replaces the diff shadow DOM', async () => {
    vi.useFakeTimers();
    const view = render(DiffViewer, { props: { oldContent: '', newContent: 'repeat', viewMode: 'unified' } });
    const { container } = view;

    await fireEvent.keyDown(container.querySelector('.pure-diff')!, { key: 'f', ctrlKey: true });
    await fireEvent.input(screen.getByPlaceholderText('Find in diff...'), { target: { value: 'repeat' } });
    await tick();
    await vi.advanceTimersByTimeAsync(150);
    await tick();

    const oldHost = container.querySelector('diffs-container')!;
    const oldHighlight = oldHost.shadowRoot!.querySelector('.diff-search-highlight')!;

    await view.rerender({ oldContent: '', newContent: 'repeat', viewMode: 'split' });
    await tick();
    await tick();

    const newHost = container.querySelector('diffs-container')!;
    expect(newHost).not.toBe(oldHost);
    expect(oldHighlight.isConnected).toBe(false);
    expect(newHost.shadowRoot!.querySelectorAll('.diff-search-highlight')).toHaveLength(4);
    expect(screen.getByText('1 / 4')).toBeTruthy();
  });

  it('seeds the find query from selected text inside shadow DOM diff content', async () => {
    const { container } = render(DiffViewer, { props: { oldContent: '', newContent: 'repeat' } });
    const host = container.querySelector('diffs-container')!;
    const selectedNode = host.shadowRoot!.querySelector('[data-line]')!.firstChild!;

    vi.spyOn(document, 'getSelection').mockReturnValue({
      isCollapsed: false,
      rangeCount: 1,
      anchorNode: selectedNode,
      focusNode: selectedNode,
      getRangeAt: () => ({ startContainer: selectedNode, endContainer: selectedNode }) as Range,
      toString: () => 'repeat',
    } as Selection);

    await fireEvent.keyDown(container.querySelector('.pure-diff')!, { key: 'f', ctrlKey: true });

    const input = screen.getByPlaceholderText('Find in diff...') as HTMLInputElement;
    expect(input.value).toBe('repeat');
    await waitFor(() => expect(screen.getByText('1 / 4')).toBeTruthy());
  });

  it('renders the find bar as a sticky row inside the scrollable diff content', async () => {
    const { container } = render(DiffViewer, { props: { oldContent: '', newContent: 'repeat', maxHeight: '120px' } });

    await fireEvent.keyDown(container.querySelector('.pure-diff')!, { key: 'f', ctrlKey: true });

    const diffContent = container.querySelector<HTMLElement>('.pure-diff-content')!;
    const searchBar = container.querySelector<HTMLElement>('.diff-search-bar')!;
    const findBar = screen.getByRole('search');

    expect(searchBar.parentElement).toBe(diffContent);
    expect(diffContent.firstElementChild).toBe(searchBar);
    expect(searchBar.classList.contains('diff-search-bar')).toBe(true);
    expect(findBar.className).toContain('rounded-lg');
    expect(findBar.className).not.toContain('rounded-none');
    expect(findBar.className).not.toContain('border-l');
    expect(findBar.className).not.toContain('absolute');
  });

  it('scrolls the owning diff content container when navigating to the selected match', async () => {
    const { container } = render(DiffViewer, { props: { oldContent: '', newContent: 'repeat', maxHeight: '120px' } });

    await fireEvent.keyDown(container.querySelector('.pure-diff')!, { key: 'f', ctrlKey: true });
    await fireEvent.input(screen.getByPlaceholderText('Find in diff...'), { target: { value: 'repeat' } });
    await waitFor(() => expect(screen.getByText('1 / 4')).toBeTruthy());

    const diffContent = container.querySelector<HTMLElement>('.pure-diff-content')!;
    diffContent.style.overflowY = 'auto';
    Object.defineProperties(diffContent, {
      clientHeight: { value: 100, configurable: true },
      clientWidth: { value: 500, configurable: true },
      scrollHeight: { value: 1000, configurable: true },
    });
    diffContent.getBoundingClientRect = () => ({ top: 0, bottom: 100, left: 0, right: 500, width: 500, height: 100 }) as DOMRect;
    diffContent.scrollTo = vi.fn(({ top }: ScrollToOptions) => {
      diffContent.scrollTop = Number(top);
    });

    const host = container.querySelector('diffs-container')!;
    const highlights = host.shadowRoot!.querySelectorAll<HTMLElement>('.diff-search-highlight');
    highlights[1].getBoundingClientRect = () => ({ top: 500, bottom: 510, left: 0, right: 10, width: 10, height: 10 }) as DOMRect;

    await fireEvent.click(screen.getByTitle('Next match (Enter)'));

    expect(screen.getByText('2 / 4')).toBeTruthy();
    expect(diffContent.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 455, behavior: 'smooth' }));
  });
});