import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  updateTabBrowserUrl,
  updateTabFavicon,
  updateTabTitle,
  updateTabViewport,
} from '$store/renderer/slices/panel-layout/panel-layout-slice';
import { updateContextItem } from '$store/renderer/slices/context/context-slice';

const dispatch = vi.hoisted(() => vi.fn());

vi.mock('$lib/components/browser/EmbeddedBrowser.svelte', async () => ({
  default: (await import('./mocks/MockEmbeddedBrowser.svelte')).default,
}));
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ dispatch });
});

import BrowserTabType from '../BrowserTabType.svelte';

describe('BrowserTabType panel layout routing', () => {
  beforeEach(() => {
    dispatch.mockClear();
  });
  afterEach(cleanup);

  it('persists browser metadata to the workspace panel layout and context scope', async () => {
    render(BrowserTabType, {
      props: {
        tab: {
          id: 'browser-tab',
          type: 'browser',
          title: 'Browser',
          closable: true,
          browserUrl: 'https://initial.example/',
          contextItemId: 'context-1',
        },
        workspaceId: 'workspace-1',
        layoutId: 'workspace-1',
        isActive: false,
        isPanelFocused: true,
      },
    });

    expect(screen.getByTestId('embedded-browser').getAttribute('data-is-active')).toBe('false');

    await fireEvent.click(screen.getByRole('button', { name: 'Navigate' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Change title' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Change favicon' }));

    expect(dispatch).toHaveBeenCalledWith(
      updateTabBrowserUrl('workspace-1', 'browser-tab', 'https://next.example/'),
    );
    expect(dispatch).toHaveBeenCalledWith(
      updateTabTitle('workspace-1', 'browser-tab', 'Next title'),
    );
    expect(dispatch).toHaveBeenCalledWith(
      updateTabFavicon('workspace-1', 'browser-tab', 'https://next.example/favicon.ico'),
    );
    expect(dispatch).toHaveBeenCalledWith(
      updateContextItem('workspace-1', 'context-1', { url: 'https://next.example/' }),
    );
    expect(dispatch).toHaveBeenCalledWith(
      updateContextItem('workspace-1', 'context-1', { title: 'Next title' }),
    );
  });

  // URL-bar autofocus only when the tab is active AND its panel is focused —
  // a focus-less reveal (restoreHiddenTab focus:false + setActiveTab) must not
  // steal keyboard focus from the conversation input.
  it.each([
    [true, true, 'true'],
    [true, false, 'false'],
    [false, true, 'false'],
  ])(
    'gates focusUrlBarOnMount on panel focus (isActive=%s, isPanelFocused=%s)',
    (isActive, isPanelFocused, expected) => {
      render(BrowserTabType, {
        props: {
          tab: {
            id: 'browser-tab',
            type: 'browser',
            title: 'Browser',
            closable: true,
            browserUrl: 'https://initial.example/',
          },
          workspaceId: 'workspace-1',
          layoutId: 'workspace-1',
          isActive,
          isPanelFocused,
        },
      });
      expect(
        screen.getByTestId('embedded-browser').getAttribute('data-focus-url-bar-on-mount'),
      ).toBe(expected);
    },
  );

  it('passes persisted viewport state through and routes viewport changes', async () => {
    render(BrowserTabType, {
      props: {
        tab: {
          id: 'browser-tab',
          type: 'browser',
          title: 'Browser',
          closable: true,
          browserUrl: 'https://initial.example/',
          viewport: { mode: 'preset', presetId: 'iphone-se', width: 375, height: 667 },
        },
        workspaceId: 'workspace-1',
        layoutId: 'layout-1',
        isActive: true,
        isPanelFocused: true,
      },
    });

    expect(screen.getByTestId('embedded-browser').getAttribute('data-viewport-mode')).toBe(
      'preset',
    );
    await fireEvent.click(screen.getByRole('button', { name: 'Change viewport' }));

    expect(dispatch).toHaveBeenCalledWith(
      updateTabViewport('layout-1', 'browser-tab', {
        mode: 'custom',
        width: 412,
        height: 915,
      }),
    );
  });
});
