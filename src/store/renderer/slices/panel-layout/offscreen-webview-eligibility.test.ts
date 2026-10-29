import { describe, expect, it } from 'vitest';
import { addItem } from '@themislib/themis/utils/collections/collection-utils';
import { emptyWorkspaceState } from './panel-layout-slice';
import type { PanelTab, WorkspacePanelLayoutState } from './panel-layout-types';
import {
  classifyOffscreenTab,
  collectOffscreenTabDecisions,
  diagnoseOffscreenTab,
  diffOffscreenDecisions,
  isDiagnosticDecisionChange,
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
      {
        tabId: 'shown-panel',
        placement: 'panel',
        reason: 'workspace-displayed',
        pinned: false,
        mounts: false,
      },
      { tabId: 'shown-hidden', placement: 'hidden', reason: null, pinned: true, mounts: true },
      {
        tabId: 'bg-user',
        placement: 'panel',
        reason: 'claimed-by-panel',
        pinned: false,
        mounts: false,
      },
      { tabId: 'bg-owned', placement: 'panel', reason: null, pinned: true, mounts: true },
      { tabId: 'bg-shell', placement: 'hidden', reason: 'no-url', pinned: true, mounts: false },
    ]);
  });
});

describe('diffOffscreenDecisions', () => {
  const decide = (layouts: Record<string, WorkspacePanelLayoutState>) =>
    collectOffscreenTabDecisions(layouts, {
      ownClientId: OWN,
      leasedTabIds: {},
      displayedWorkspaceIds: new Set(),
    });

  it('reports a tab once when it appears, again only when its decision changes, and when it leaves', () => {
    const shell = browserTab({ id: 't', hostClientId: OWN, browserUrl: undefined });
    const first = diffOffscreenDecisions(new Map(), decide({ w: layout([], [shell]) }));
    expect(first.changes).toEqual([
      { tabId: 't', workspaceId: 'w', placement: 'hidden', from: undefined, to: 'no-url' },
    ]);

    const unchanged = diffOffscreenDecisions(first.next, decide({ w: layout([], [shell]) }));
    expect(unchanged.changes).toEqual([]);

    const filled = diffOffscreenDecisions(
      unchanged.next,
      decide({ w: layout([], [{ ...shell, browserUrl: 'http://127.0.0.1:5173/' }]) }),
    );
    expect(filled.changes).toEqual([
      { tabId: 't', workspaceId: 'w', placement: 'hidden', from: 'no-url', to: 'eligible' },
    ]);

    const closed = diffOffscreenDecisions(filled.next, decide({ w: layout([]) }));
    expect(closed.changes).toEqual([
      { tabId: 't', workspaceId: 'w', from: 'eligible', to: 'gone' },
    ]);
    expect(closed.next.size).toBe(0);
  });
});

describe('diagnoseOffscreenTab', () => {
  const base = {
    workspaceId: 'w',
    tabId: 'tab-1',
    ownClientId: OWN,
    leasedTabIds: {},
    workspaceDisplayed: false,
    backgroundHosted: false,
    registry: { phase: 'applied', reported: { 'tab-1': {} }, unresolved: {} },
    offscreenElement: false,
  };

  it('names a URL-less hidden shell as the reason no guest mounted', () => {
    const shell = browserTab({ hostClientId: OWN, browserUrl: undefined, ownerAgentId: 'agent-1' });
    expect(diagnoseOffscreenTab({ ...base, layout: layout([], [shell]) })).toMatchObject({
      location: 'hidden',
      decision: 'no-url',
      hasUrl: false,
      owned: true,
      hostClientId: OWN,
      registryReported: true,
      offscreenElement: false,
    });
  });

  it('separates a tab the layout never received from a workspace with no layout', () => {
    expect(diagnoseOffscreenTab({ ...base, layout: layout([]) })).toMatchObject({
      location: 'absent',
      decision: null,
    });
    expect(diagnoseOffscreenTab({ ...base, layout: undefined, registry: null })).toMatchObject({
      location: 'no-layout',
      restoreStatus: null,
      registryPhase: null,
    });
  });

  it('reports an eligible tab whose guest is missing as eligible without an element', () => {
    const tab = browserTab({ hostClientId: OWN });
    expect(diagnoseOffscreenTab({ ...base, layout: layout([tab]) })).toMatchObject({
      location: 'panel',
      decision: 'eligible',
      offscreenElement: false,
    });
  });
});

describe('isDiagnosticDecisionChange', () => {
  const change = (from: string | undefined, to: string) =>
    ({ tabId: 't', workspaceId: 'w', from, to }) as Parameters<
      typeof isDiagnosticDecisionChange
    >[0];

  it('logs entering and leaving a reason that blocks the mount', () => {
    expect(isDiagnosticDecisionChange(change(undefined, 'no-url'))).toBe(true);
    expect(isDiagnosticDecisionChange(change('eligible', 'hosted-elsewhere'))).toBe(true);
    expect(isDiagnosticDecisionChange(change('no-url', 'eligible'))).toBe(true);
    expect(isDiagnosticDecisionChange(change('url-not-loadable', 'gone'))).toBe(true);
  });

  it('stays quiet for ordinary workspace switches and mounts', () => {
    expect(isDiagnosticDecisionChange(change(undefined, 'eligible'))).toBe(false);
    expect(isDiagnosticDecisionChange(change('eligible', 'workspace-displayed'))).toBe(false);
    expect(isDiagnosticDecisionChange(change('workspace-displayed', 'claimed-by-panel'))).toBe(
      false,
    );
    expect(isDiagnosticDecisionChange(change('eligible', 'gone'))).toBe(false);
  });
});
