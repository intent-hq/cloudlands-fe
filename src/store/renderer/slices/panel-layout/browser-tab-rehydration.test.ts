import { describe, expect, it } from 'vitest';

import {
  collectRehydratableBrowserTabs,
  rebaseRequestedUrlForNavigation,
} from './browser-tab-rehydration';
import type { PanelTab } from './panel-layout-types';

describe('rebaseRequestedUrlForNavigation', () => {
  const requested = 'http://daemon.localhost:3000/';
  const tunneled = 'http://127.0.0.1:52345/';

  it('rebases path/query/hash onto the requested URL for same-origin navigations', () => {
    expect(
      rebaseRequestedUrlForNavigation(tunneled, 'http://127.0.0.1:52345/app?x=1#top', requested),
    ).toBe('http://daemon.localhost:3000/app?x=1#top');
  });

  it('clears the requested URL when the navigation leaves the origin', () => {
    expect(
      rebaseRequestedUrlForNavigation(tunneled, 'https://example.com/', requested),
    ).toBeUndefined();
  });

  it('clears when no requested URL was recorded', () => {
    expect(
      rebaseRequestedUrlForNavigation(tunneled, 'http://127.0.0.1:52345/app', undefined),
    ).toBeUndefined();
  });

  it('clears when the previous URL is missing or unparseable', () => {
    expect(
      rebaseRequestedUrlForNavigation(undefined, 'http://127.0.0.1:52345/app', requested),
    ).toBeUndefined();
    expect(
      rebaseRequestedUrlForNavigation('not a url', 'http://127.0.0.1:52345/app', requested),
    ).toBeUndefined();
  });

  it('clears when the navigated URL is unparseable', () => {
    expect(rebaseRequestedUrlForNavigation(tunneled, 'not a url', requested)).toBeUndefined();
  });
});

describe('collectRehydratableBrowserTabs', () => {
  function browserTab(overrides: Partial<PanelTab>): PanelTab {
    return { id: 'tab-1', type: 'browser', title: 'Browser', closable: true, ...overrides };
  }

  it('collects browser tabs carrying a persisted requested URL', () => {
    const layout = {
      panels: {
        'panel-1': {
          id: 'panel-1',
          activeTabId: 'tab-1',
          tabs: [
            browserTab({
              browserUrl: 'http://127.0.0.1:52345/',
              browserRequestedUrl: 'http://daemon.localhost:3000/',
            }),
            browserTab({ id: 'tab-2', browserUrl: 'https://example.com/' }),
            { id: 'tab-3', type: 'note' as const, title: 'Note', closable: true },
          ],
        },
      },
    };

    expect(collectRehydratableBrowserTabs(layout)).toEqual([
      {
        tabId: 'tab-1',
        requestedUrl: 'http://daemon.localhost:3000/',
        storedUrl: 'http://127.0.0.1:52345/',
      },
    ]);
  });

  it('returns nothing for legacy layouts without requested URLs', () => {
    const layout = {
      panels: {
        'panel-1': {
          id: 'panel-1',
          activeTabId: 'tab-1',
          tabs: [browserTab({ browserUrl: 'http://127.0.0.1:3000/' })],
        },
      },
    };
    expect(collectRehydratableBrowserTabs(layout)).toEqual([]);
  });

  it('skips tabs missing a stored URL', () => {
    const layout = {
      panels: {
        'panel-1': {
          id: 'panel-1',
          activeTabId: 'tab-1',
          tabs: [browserTab({ browserRequestedUrl: 'http://daemon.localhost:3000/' })],
        },
      },
    };
    expect(collectRehydratableBrowserTabs(layout)).toEqual([]);
  });
});
