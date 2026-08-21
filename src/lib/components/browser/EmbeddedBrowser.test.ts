import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$store/renderer/slices/browser/browser-selectors', () => ({
  selectPendingBrowserZoom: () => null,
}));

vi.mock('$store/renderer/store', () => ({
  store: { dispatch: vi.fn() },
}));

vi.mock('$lib/components/ui/toast', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

// The owner-chip navigation helper transitively imports selector modules
// that register against the real store at load time.
vi.mock('$lib/utils/workspace-navigation', () => ({
  navigateToAgent: vi.fn(),
}));

import EmbeddedBrowser from './EmbeddedBrowser.svelte';
import { navigateToAgent } from '$lib/utils/workspace-navigation';

afterEach(cleanup);

describe('EmbeddedBrowser', () => {
  it('mounts a blank webview for about:blank', () => {
    const { container } = render(EmbeddedBrowser, {
      props: { url: 'about:blank', workspaceId: 'workspace-1' },
    });

    expect(container.querySelector('webview')?.getAttribute('src')).toBe('about:blank');
  });

  describe('owner chip', () => {
    const renderWithOwner = (extraProps: Record<string, unknown> = {}) =>
      render(EmbeddedBrowser, {
        props: {
          url: 'about:blank',
          workspaceId: 'workspace-1',
          ownerAgentId: 'agent-1',
          ownerAgentName: 'Coordinator',
          ...extraProps,
        },
      });

    it('renders icon-only with no name text and no pill background', () => {
      const { container } = renderWithOwner();

      const chip = container.querySelector('[data-browser-owner-chip="agent-1"]');
      expect(chip).not.toBeNull();
      expect(chip!.textContent?.trim()).toBe('');
      expect(chip!.querySelector('svg')).not.toBeNull();
      expect(chip!.classList.contains('bg-muted')).toBe(false);
      expect(chip!.classList.contains('rounded-full')).toBe(false);
    });

    it('exposes the agent name for hover/assistive tech', () => {
      const { container } = renderWithOwner();

      const chip = container.querySelector('[data-browser-owner-chip]');
      expect(chip!.getAttribute('aria-label')).toContain('Coordinator');
    });

    it('sits in the actions group before the devtools toggle', () => {
      const { container, getByLabelText } = renderWithOwner();

      const chip = container.querySelector('[data-browser-owner-chip]')!;
      const devtools = getByLabelText('Toggle developer tools');
      const actions = devtools.closest('.gap-0\\.5');
      expect(actions?.contains(chip)).toBe(true);
      expect(chip.compareDocumentPosition(devtools) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('navigates to the owning agent on click', async () => {
      const { container } = renderWithOwner();

      await fireEvent.click(container.querySelector('[data-browser-owner-chip]')!);
      expect(navigateToAgent).toHaveBeenCalledWith('agent-1');
    });

    it('is absent for unowned tabs', () => {
      const { container } = render(EmbeddedBrowser, {
        props: { url: 'about:blank', workspaceId: 'workspace-1' },
      });

      expect(container.querySelector('[data-browser-owner-chip]')).toBeNull();
    });

    it('keeps the viewport indicator pill unchanged', () => {
      const { container } = renderWithOwner({ emulatedSize: { width: 1280, height: 800 } });

      const indicator = container.querySelector('[data-browser-viewport-indicator]');
      expect(indicator).not.toBeNull();
      expect(indicator!.textContent).toContain('1280×800');
      expect(indicator!.className).toContain('bg-muted');
      expect(indicator!.className).toContain('rounded-full');
    });
  });
});
