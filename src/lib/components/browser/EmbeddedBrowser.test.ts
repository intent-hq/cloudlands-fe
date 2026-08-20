import { cleanup, render } from '@testing-library/svelte';
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

afterEach(cleanup);

describe('EmbeddedBrowser', () => {
  it('mounts a blank webview for about:blank', () => {
    const { container } = render(EmbeddedBrowser, {
      props: { url: 'about:blank', workspaceId: 'workspace-1' },
    });

    expect(container.querySelector('webview')?.getAttribute('src')).toBe('about:blank');
  });
});
