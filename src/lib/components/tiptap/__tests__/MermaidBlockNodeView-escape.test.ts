/**
 * MermaidBlockNodeView.svelte fullscreen Escape handling via the
 * escape-layer stack. Migrated from a manual `document` keydown listener;
 * the layer is only registered while the fullscreen overlay is open.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/svelte';
import type { NodeViewProps } from '@tiptap/core';
import { toast } from '$lib/components/ui/toast';

// Only rendering is stubbed; snapshot guards, lightbox and Escape layers stay real.
vi.mock('$lib/components/markdown/MermaidRenderer.svelte', async () => ({
  default: (await import('./MermaidRendererFullscreenFixture.svelte')).default,
}));

vi.mock('$lib/components/ui/toast', () => ({ toast: { error: vi.fn() } }));

vi.mock('$store/renderer/slices/theme/theme-selectors', async () => {
  const { createAppStoreMock } = await import('$store/renderer/utils/test-helpers/store-mock');
  const store = createAppStoreMock({ state: {} });
  return { selectIsDarkTheme: store.createSelector(() => false) };
});

import MermaidBlockNodeView from '../MermaidBlockNodeView.svelte';

const FULLSCREEN_LABEL = 'Fullscreen diagram view';

function makeProps(code = 'graph TD; A-->B'): Partial<NodeViewProps> {
  return {
    node: { attrs: { code } } as unknown as NodeViewProps['node'],
    selected: false,
    updateAttributes: vi.fn(),
  };
}

async function renderAndOpenFullscreen() {
  const { container } = render(MermaidBlockNodeView, {
    props: makeProps() as NodeViewProps,
  });

  const expandButton = container.querySelector('button[title="Fullscreen"]') as HTMLButtonElement;
  expect(expandButton).toBeTruthy();
  await fireEvent.click(expandButton);
  await waitFor(() => {
    expect(screen.getByLabelText(FULLSCREEN_LABEL)).toBeTruthy();
  });
  expect(screen.getByLabelText(FULLSCREEN_LABEL).textContent).toContain('Start');
  expect(screen.getByLabelText(FULLSCREEN_LABEL).textContent).toContain('Finish');
  return expandButton;
}

describe('MermaidBlockNodeView fullscreen Escape handling (escape-layer stack)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('Escape closes the fullscreen overlay', async () => {
    const expandButton = await renderAndOpenFullscreen();

    await fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByLabelText(FULLSCREEN_LABEL)).toBeFalsy();
      expect(document.activeElement).toBe(expandButton);
    });
  });

  it('renders the zoom/pan viewport and controls in fullscreen mode', async () => {
    await renderAndOpenFullscreen();

    expect(screen.getByTestId('zoom-pan-viewport')).toBeTruthy();
    expect(screen.getByTestId('zoom-pan-controls')).toBeTruthy();
    expect(screen.getByTestId('zoom-pan-slider')).toBeTruthy();
    const slider = screen.getByTestId('zoom-pan-slider') as HTMLInputElement;
    const initialZoom = Number(slider.value);
    await fireEvent.keyDown(screen.getByTestId('zoom-pan-viewport'), { key: '+' });
    expect(Number(slider.value)).toBeGreaterThan(initialZoom);
    await fireEvent.keyDown(screen.getByTestId('zoom-pan-viewport'), { key: '0' });
    expect(Number(slider.value)).toBe(initialZoom);
  });

  it.each([
    ['empty', ''],
    ['pending', 'pending'],
    ['error', 'error'],
  ])('rejects the %s graph without opening fullscreen or consuming Escape', async (_, code) => {
    render(MermaidBlockNodeView, { props: makeProps(code) as NodeViewProps });

    await fireEvent.click(screen.getByRole('button', { name: 'Fullscreen' }));

    expect(toast.error).toHaveBeenCalledOnce();
    expect(screen.queryByLabelText(FULLSCREEN_LABEL)).toBeFalsy();
    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
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
