import { describe, expect, it } from 'vitest';
import { addItem } from '@themislib/themis/utils/collections/collection-utils';
import { emptyWorkspaceState } from '$store/renderer/slices/panel-layout/panel-layout-slice';
import type {
  PanelTab,
  WorkspacePanelLayoutState,
} from '$store/renderer/slices/panel-layout/panel-layout-types';
import {
  classifyOffscreenTab,
  collectOffscreenTabDecisions,
  type OffscreenEligibilityContext,
} from './offscreen-webview-eligibility';

const OWN = 'client-own';

function browserTab(overrides: Partial<PanelTab> = {}): PanelTab {
  return {
    id: 'tab-1',
    type: 'browser',
    title: 'Browser',
    closable: true,
    browserUrl: 'http://127.0.0.1:5173/',
    ...overrides,
  };
}

function layout(panelTabs: PanelTab[], hidden: PanelTab[] = []): WorkspacePanelLayoutState {
  let hiddenTabs = emptyWorkspaceState.hiddenTabs;
  for (const tab of hidden) hiddenTabs = addItem(hiddenTabs, tab);
  return {
    ...emptyWorkspaceState,
    root: { type: 'panel', panelId: 'p1' },
    panels: { p1: { id: 'p1', tabs: panelTabs, activeTabId: panelTabs[0]?.id ?? null } },
    focusedPanelId: 'p1',
    hiddenTabs,
  };
}

const background: OffscreenEligibilityContext = {
  ownClientId: OWN,
  leased: false,
  placement: 'hidden',
  workspaceDisplayed: false,
};

describe('classifyOffscreenTab', () => {
  it('mounts a hosted, loadable tab of a background workspace', () => {
    expect(classifyOffscreenTab(browserTab({ hostClientId: OWN }), background)).toEqual({
      eligible: true,
    });
  });

  it('mounts a tab no registry has acknowledged yet', () => {
    expect(classifyOffscreenTab(browserTab(), background)).toEqual({ eligible: true });
  });

  it('reports no-url for a registry-hosted shell restored without its URL', () => {
    const shell = browserTab({ hostClientId: OWN, browserUrl: undefined });
    expect(classifyOffscreenTab(shell, background)).toEqual({ eligible: false, reason: 'no-url' });
  });

  it('reports url-not-loadable for a scheme the embedded browser refuses', () => {
    const tab = browserTab({ browserUrl: 'javascript:alert(1)' });
    expect(classifyOffscreenTab(tab, background)).toEqual({
      eligible: false,
      reason: 'url-not-loadable',
    });
  });

  it('keeps about:blank mountable so a later navigation can leave it', () => {
    expect(classifyOffscreenTab(browserTab({ browserUrl: 'about:blank' }), background)).toEqual({
      eligible: true,
    });
  });

  it('reports hosted-elsewhere for another client tab and while the own id is unknown', () => {
    const foreign = browserTab({ hostClientId: 'client-other' });
    expect(classifyOffscreenTab(foreign, background)).toEqual({
      eligible: false,
      reason: 'hosted-elsewhere',
    });
    const acknowledged = browserTab({ hostClientId: OWN });
    expect(classifyOffscreenTab(acknowledged, { ...background, ownClientId: null })).toEqual({
      eligible: false,
      reason: 'hosted-elsewhere',
    });
  });

  it('reports claimed-by-panel while a panel webview holds the lease', () => {
    expect(classifyOffscreenTab(browserTab(), { ...background, leased: true })).toEqual({
      eligible: false,
      reason: 'claimed-by-panel',
    });
  });

  it('defers visible tabs of the displayed workspace to their panel but not hidden ones', () => {
    const displayed = { ...background, workspaceDisplayed: true };
    expect(classifyOffscreenTab(browserTab(), { ...displayed, placement: 'panel' })).toEqual({
      eligible: false,
      reason: 'workspace-displayed',
    });
    expect(classifyOffscreenTab(browserTab(), displayed)).toEqual({ eligible: true });
  });

  it('reports not-browser for other tab types', () => {
    const note: PanelTab = { id: 'n', type: 'note', title: 'Note', closable: true };
    expect(classifyOffscreenTab(note, background)).toEqual({
      eligible: false,
      reason: 'not-browser',
    });
  });
});

describe('collectOffscreenTabDecisions', () => {
  it('classifies panel and hidden browser tabs per workspace and pins hidden or owned ones', () => {
    const decisions = collectOffscreenTabDecisions(
      {
        shown: layout([browserTab({ id: 'shown-panel' })], [browserTab({ id: 'shown-hidden' })]),
        background: layout(
          [
            browserTab({ id: 'bg-user' }),
            browserTab({ id: 'bg-owned', ownerAgentId: 'agent-1' }),
            { id: 'bg-note', type: 'note', title: 'Note', closable: true },
          ],
          [browserTab({ id: 'bg-shell', hostClientId: OWN, browserUrl: undefined })],
        ),
      },
      {
        ownClientId: OWN,
        leasedTabIds: { 'bg-user': { lease: true } },
        displayedWorkspaceIds: new Set(['shown']),
      },
    );

    expect(
      decisions.map(({ tabId, placement, eligibility, pinned, url }) => ({
        tabId,
        placement,
        reason: eligibility.eligible ? null : eligibility.reason,
        pinned,
        mounts: url !== undefined,
      })),
    ).toEqual([
      { tabId: 'shown-panel', placement: 'panel', reason: 'workspace-displayed', pinned: false, mounts: false },
      { tabId: 'shown-hidden', placement: 'hidden', reason: null, pinned: true, mounts: true },
      { tabId: 'bg-user', placement: 'panel', reason: 'claimed-by-panel', pinned: false, mounts: false },
      { tabId: 'bg-owned', placement: 'panel', reason: null, pinned: true, mounts: true },
      { tabId: 'bg-shell', placement: 'hidden', reason: 'no-url', pinned: true, mounts: false },
    ]);
  });
});
