/**
 * MermaidBlockNodeView.svelte fullscreen Escape handling via the
 * escape-layer stack. Migrated from a manual `document` keydown listener;
 * the layer is only registered while the fullscreen overlay is open.
 */
import {
  describe,
  it,
  expect,
  vi,
  afterEach,
} from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from '@testing-library/svelte';
import type { NodeViewProps } from '@tiptap/core';

// Stub the diagram renderer — the escape layer lives on the node view.
vi.mock('$lib/components/markdown/MermaidRenderer.svelte', async () => ({
  default: (
    await import(
      '../../workspace/initializer/__tests__/mocks/MockComponent.svelte'
    )
  ).default,
}));

vi.mock('$store/renderer/slices/theme/theme-selectors', async () => {
  const { createAppStoreMock } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  const store = createAppStoreMock({ state: {} });
  return { selectIsDarkTheme: store.createSelector(() => false) };
});

import MermaidBlockNodeView from '../MermaidBlockNodeView.svelte';

const FULLSCREEN_LABEL = 'Fullscreen diagram view';

function makeProps(): Partial<NodeViewProps> {
  return {
    node: { attrs: { code: 'graph TD; A-->B' } } as unknown as NodeViewProps['node'],
    selected: false,
    updateAttributes: vi.fn(),
  };
}

async function renderAndOpenFullscreen() {
  const { container } = render(MermaidBlockNodeView, {
    props: makeProps() as NodeViewProps,
  });

  const expandButton = container.querySelector(
    'button[title="Fullscreen"]',
  ) as HTMLButtonElement;
  expect(expandButton).toBeTruthy();
  await fireEvent.click(expandButton);
  await waitFor(() => {
    expect(screen.getByLabelText(FULLSCREEN_LABEL)).toBeTruthy();
  });
}

describe('MermaidBlockNodeView fullscreen Escape handling (escape-layer stack)', () => {
  afterEach(() => {
    cleanup();
  });

  it('Escape closes the fullscreen overlay', async () => {
    await renderAndOpenFullscreen();

    await fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByLabelText(FULLSCREEN_LABEL)).toBeFalsy();
    });
  });

  it('renders the zoom/pan viewport and controls in fullscreen mode', async () => {
    await renderAndOpenFullscreen();

    expect(screen.getByTestId('zoom-pan-viewport')).toBeTruthy();
    expect(screen.getByTestId('zoom-pan-controls')).toBeTruthy();
    expect(screen.getByTestId('zoom-pan-slider')).toBeTruthy();
  });

  it('Escape is not consumed while not fullscreen (no layer registered)', async () => {
    render(MermaidBlockNodeView, { props: makeProps() as NodeViewProps });
    expect(screen.queryByLabelText(FULLSCREEN_LABEL)).toBeFalsy();

    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });
});
