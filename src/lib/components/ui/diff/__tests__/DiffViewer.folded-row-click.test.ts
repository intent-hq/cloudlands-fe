import {
  cleanup,
  render,
  waitFor,
} from '@testing-library/svelte';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import DiffViewer from '../DiffViewer.svelte';

const testState = vi.hoisted(() => {
  function createReadable<T>(value: T) {
    return {
      subscribe(subscriber: (value: T) => void) {
        subscriber(value);
        return () => undefined;
      },
    };
  }

  return {
    createReadable,
    renderCalls: 0,
    nativeExpandActivations: 0,
    expandButtonClicks: 0,
  };
});

vi.mock('$store/renderer/slices/user-preferences/user-preferences-selectors', () => ({
  selectCodeFontFamilyCSS: () => testState.createReadable('monospace'),
}));

vi.mock('$store/renderer/slices/theme/theme-selectors', () => ({
  selectIsDarkTheme: () => testState.createReadable(false),
}));

vi.mock('$lib/utils/diff-highlighter-preloader', () => ({
  getDiffWorkerPool: () => undefined,
  getSafeDiffLanguage: (language?: string) => language ?? 'text',
}));

vi.mock('svelte-fa', async () => {
  const MockSimple = (await import('./mocks/MockSimple.svelte')).default;
  return { default: MockSimple };
});

vi.mock('@fortawesome/free-solid-svg-icons', () => ({
  faChevronDown: {},
  faChevronUp: {},
  faSearch: {},
  faXmark: {},
}));

vi.mock('@pierre/diffs', () => {
  function createFoldedRowHost() {
    const host = document.createElement('diffs-container');
    const shadowRoot = host.attachShadow({ mode: 'open' });
    const pre = document.createElement('pre');
    const foldedRow = document.createElement('div');
    const wrapper = document.createElement('div');
    const expandButton = document.createElement('div');
    const rowClickTarget = document.createElement('div');
    const separatorContent = document.createElement('div');
    const nativeLabel = document.createElement('span');

    foldedRow.setAttribute('data-separator', 'line-info');
    foldedRow.setAttribute('data-expand-index', '0');
    wrapper.setAttribute('data-separator-wrapper', '');
    expandButton.setAttribute('data-expand-button', '');
    expandButton.setAttribute('data-expand-down', '');
    rowClickTarget.setAttribute('data-test-folded-row-click-target', '');
    separatorContent.setAttribute('data-separator-content', '');
    nativeLabel.setAttribute('data-unmodified-lines', '');

    rowClickTarget.textContent = 'folded row background';
    nativeLabel.textContent = '12 unchanged lines';
    expandButton.addEventListener('click', () => {
      testState.expandButtonClicks += 1;
    });
    pre.addEventListener('click', (event) => {
      const path = event.composedPath();
      const isNativeExpandClick = path.some(
        (target) =>
          target instanceof Element &&
          target.closest('[data-expand-button], [data-unmodified-lines]') != null,
      );
      if (isNativeExpandClick) testState.nativeExpandActivations += 1;
    });

    separatorContent.append(nativeLabel);
    wrapper.append(expandButton, rowClickTarget, separatorContent);
    foldedRow.append(wrapper);
    pre.append(foldedRow);
    shadowRoot.append(pre);
    return host;
  }

  class MockFileDiff {
    setOptions() {}
    setLineAnnotations() {}
    setThemeType() {}
    rerender() {}
    cleanUp() {}
    render({ containerWrapper }: { containerWrapper: HTMLElement }) {
      testState.renderCalls += 1;
      containerWrapper.append(createFoldedRowHost());
    }
  }

  return {
    FileDiff: MockFileDiff,
    VirtualizedFileDiff: MockFileDiff,
    parseDiffFromFile: () => ({ hunks: [] }),
    parsePatchFiles: () => [],
  };
});

async function renderFoldedRowDiff() {
  const result = render(DiffViewer, {
    props: {
      fileName: 'file.ts',
      oldContent: 'before',
      newContent: 'after',
      showHeader: false,
    },
  });

  await waitFor(() => expect(testState.renderCalls).toBe(1));
  const host = result.container.querySelector('diffs-container');
  const shadowRoot = host?.shadowRoot;
  expect(shadowRoot).toBeTruthy();

  return {
    rowClickTarget: shadowRoot!.querySelector<HTMLElement>('[data-test-folded-row-click-target]')!,
    expandButton: shadowRoot!.querySelector<HTMLElement>('[data-expand-button]')!,
  };
}

describe('DiffViewer folded row click delegation', () => {
  beforeEach(() => {
    testState.renderCalls = 0;
    testState.nativeExpandActivations = 0;
    testState.expandButtonClicks = 0;
  });

  afterEach(() => cleanup());

  it('delegates whole-row clicks from inside the diffs Shadow DOM to the folded row expand button', async () => {
    const { rowClickTarget } = await renderFoldedRowDiff();

    rowClickTarget.dispatchEvent(
      new MouseEvent('click', { bubbles: true, composed: true, button: 0 }),
    );

    expect(testState.expandButtonClicks).toBe(1);
    expect(testState.nativeExpandActivations).toBe(1);
  });

  it('does not delegate native expand button clicks a second time', async () => {
    const { expandButton } = await renderFoldedRowDiff();

    expandButton.dispatchEvent(
      new MouseEvent('click', { bubbles: true, composed: true, button: 0 }),
    );

    expect(testState.expandButtonClicks).toBe(1);
    expect(testState.nativeExpandActivations).toBe(1);
  });
});
