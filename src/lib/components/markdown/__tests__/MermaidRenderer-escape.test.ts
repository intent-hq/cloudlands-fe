/**
 * MermaidRenderer.svelte fullscreen Escape handling via the escape-layer
 * stack. Migrated from a manual `document` keydown listener; the layer is
 * only registered while the fullscreen overlay is open.
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

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    registerLayoutLoaders: vi.fn(),
    render: vi.fn(async () => ({ svg: '<svg data-testid="diagram"></svg>' })),
  },
}));

vi.mock('@mermaid-js/layout-elk', () => ({ default: [] }));

vi.mock('$store/renderer/slices/theme/theme-selectors', async () => {
  const { createAppStoreMock } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  const store = createAppStoreMock({ state: {} });
  return { selectIsDarkTheme: store.createSelector(() => false) };
});

import MermaidRenderer from '../MermaidRenderer.svelte';

const FULLSCREEN_LABEL = 'Fullscreen diagram view';

async function renderAndOpenFullscreen() {
  render(MermaidRenderer, { props: { code: 'graph TD; A-->B' } });

  const expandButton = await waitFor(() => {
    const el = screen.getByLabelText('Expand diagram to fullscreen');
    return el as HTMLButtonElement;
  });
  await fireEvent.click(expandButton);
  await waitFor(() => {
    expect(screen.getByLabelText(FULLSCREEN_LABEL)).toBeTruthy();
  });
}

describe('MermaidRenderer fullscreen Escape handling (escape-layer stack)', () => {
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
    render(MermaidRenderer, { props: { code: 'graph TD; A-->B' } });
    await waitFor(() => {
      expect(screen.getByLabelText('Expand diagram to fullscreen')).toBeTruthy();
    });

    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByLabelText(FULLSCREEN_LABEL)).toBeFalsy();
  });
});
