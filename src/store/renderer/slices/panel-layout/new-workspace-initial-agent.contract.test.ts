import { describe, expect, it } from 'vitest';
import {
  bootstrapNewWorkspaceLayout,
  initializeLayout,
  openTabInNewRootColumn,
  panelLayoutReducer,
  resolveNewWorkspaceInitialAgent,
} from './panel-layout-slice';
import type { PanelLayoutSliceState } from './panel-layout-types';

const WS = 'initial-agent-contract';

function initialState(): PanelLayoutSliceState {
  return { byWorkspaceId: {} };
}

function agentTabs(state: PanelLayoutSliceState) {
  return Object.values(state.byWorkspaceId[WS].panels)
    .flatMap((panel) => panel.tabs)
    .filter((tab) => tab.type === 'agent');
}

describe('new workspace initial-agent contract', () => {
  it.each([true, false])(
    'opens one focused initial agent column when coordinator=%s',
    (coordinator) => {
      const state = panelLayoutReducer(
        initialState(),
        bootstrapNewWorkspaceLayout(WS, 'agent-initial', 'Initial agent', coordinator),
      );
      const workspace = state.byWorkspaceId[WS];
      const panel = Object.values(workspace.panels).find((candidate) =>
        candidate.tabs.some((tab) => tab.agentId === 'agent-initial'),
      );

      expect(agentTabs(state)).toHaveLength(1);
      expect(panel).not.toHaveProperty('pinned');
      expect(Object.values(workspace.panels)).toHaveLength(1);
      expect(workspace.focusedPanelId).toBe(panel?.id);
      expect(workspace.pendingFocusTabId).toBeNull();
      expect(workspace.pendingPanelReveal).toMatchObject({
        panelId: panel?.id,
        tabId: panel?.activeTabId,
      });
    },
  );

  it('adopts a delayed daemon snapshot once without duplicate tabs', () => {
    const pending = panelLayoutReducer(
      initialState(),
      bootstrapNewWorkspaceLayout(WS, null, 'Initial agent', false),
    );
    const resolved = panelLayoutReducer(
      pending,
      resolveNewWorkspaceInitialAgent(WS, 'agent-initial', 'Initial agent', 10),
    );
    const repeated = panelLayoutReducer(
      resolved,
      resolveNewWorkspaceInitialAgent(WS, 'agent-late', 'Late duplicate', 20),
    );

    expect(agentTabs(repeated)).toEqual([
      expect.objectContaining({ agentId: 'agent-initial', title: 'Initial agent' }),
    ]);
    expect(repeated.byWorkspaceId[WS].newWorkspaceLifecycle).toMatchObject({
      initialAgentId: 'agent-initial',
      initialAgentPending: false,
    });
  });

  it('reuses an equivalent initial-agent tab opened before the daemon snapshot', () => {
    const pending = panelLayoutReducer(
      initialState(),
      bootstrapNewWorkspaceLayout(WS, null, 'Initial agent', false, 1),
    );
    const alreadyOpen = panelLayoutReducer(
      pending,
      openTabInNewRootColumn(
        WS,
        {
          type: 'agent',
          title: 'Initial agent',
          agentId: 'agent-initial',
          workspaceId: WS,
          closable: true,
        },
        { force: true },
        2,
      ),
    );
    const resolved = panelLayoutReducer(
      alreadyOpen,
      resolveNewWorkspaceInitialAgent(WS, 'agent-initial', 'Initial agent', 3),
    );
    const workspace = resolved.byWorkspaceId[WS];
    const panel = Object.values(workspace.panels).find((candidate) =>
      candidate.tabs.some((tab) => tab.agentId === 'agent-initial'),
    );

    expect(agentTabs(resolved)).toHaveLength(1);
    expect(panel).not.toHaveProperty('pinned');
    expect(workspace.pendingPanelReveal?.panelId).toBe(panel?.id);
    expect(workspace.newWorkspaceLifecycle?.initialAgentPending).toBe(false);
  });

  it('restores the initial agent without replaying bootstrap work', () => {
    const created = panelLayoutReducer(
      initialState(),
      bootstrapNewWorkspaceLayout(WS, 'agent-initial', 'Initial agent', true),
    ).byWorkspaceId[WS];
    const restored = panelLayoutReducer(
      initialState(),
      initializeLayout(WS, {
        root: created.root,
        panels: created.panels,
        focusedPanelId: created.focusedPanelId,
        deferSpecTab: created.deferSpecTab,
        newWorkspaceLifecycle: created.newWorkspaceLifecycle,
      }),
    );
    const repeated = panelLayoutReducer(
      restored,
      resolveNewWorkspaceInitialAgent(WS, 'agent-initial', 'Initial agent', 30),
    );

    expect(agentTabs(repeated)).toHaveLength(1);
    expect(repeated.byWorkspaceId[WS].panels[created.focusedPanelId!]).not.toHaveProperty('pinned');
  });

  it.each([true, false])(
    'starts with only the initial agent column when coordinator=%s',
    (coordinator) => {
      const workspace = panelLayoutReducer(
        initialState(),
        bootstrapNewWorkspaceLayout(WS, 'agent-initial', 'Initial agent', coordinator),
      ).byWorkspaceId[WS];
      expect(workspace.root.type).toBe('panel');
      expect(Object.values(workspace.panels)).toHaveLength(1);
      expect(Object.values(workspace.panels)[0].tabs).toEqual([
        expect.objectContaining({ agentId: 'agent-initial' }),
      ]);
    },
  );
});
