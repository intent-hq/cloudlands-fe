import { describe, expect, it } from 'vitest';

import { migratePanelLayoutForWorkspace } from './panel-layout-migration';
import {
  PANEL_LAYOUT_PERSISTENCE_VERSION,
  type PanelLayoutNode,
  type PanelState,
  type WorkspacePanelLayout,
} from './panel-layout-types';

const WS = 'workspace-1';

function panel(id: string, tabIds: string[] = [`tab-${id}`]): PanelState {
  return {
    id,
    tabs: tabIds.map((tabId) => ({
      id: tabId,
      type: 'note',
      title: tabId,
      noteId: tabId,
      workspaceId: WS,
      closable: true,
    })),
    activeTabId: tabIds[0] ?? null,
  };
}

function horizontal(ids: string[], sizes = ids.map(() => 100 / ids.length)): PanelLayoutNode {
  return ids.length === 1
    ? { type: 'panel', panelId: ids[0] }
    : {
        type: 'split',
        direction: 'horizontal',
        children: ids.map((panelId) => ({ type: 'panel', panelId })),
        sizes,
      };
}

function layout(root: PanelLayoutNode, panels: Record<string, PanelState>): WorkspacePanelLayout {
  return {
    root,
    panels,
    focusedPanelId: Object.keys(panels).at(-1) ?? null,
    canvasWidth: 900,
    canvasWidthSource: 'explicit',
  };
}

function order(result: WorkspacePanelLayout): string[] {
  return result.root.type === 'panel'
    ? [result.root.panelId]
    : result.root.children.map((child) => (child.type === 'panel' ? child.panelId : 'nested'));
}

describe('migratePanelLayoutForWorkspace', () => {
  it.each([1, 2, 3, 4])('flattens %i legacy leaves into at most three columns', (leafCount) => {
    const ids = Array.from({ length: leafCount }, (_, index) => `p${index + 1}`);
    const result = migratePanelLayoutForWorkspace(
      WS,
      layout(horizontal(ids), Object.fromEntries(ids.map((id) => [id, panel(id)]))),
    );

    expect(result.version).toBe(PANEL_LAYOUT_PERSISTENCE_VERSION);
    expect(result.columnCount).toBe(Math.min(3, leafCount));
    expect(order(result)).toEqual(ids.slice(0, 3));
    expect(Object.values(result.panels).flatMap((candidate) => candidate.tabs)).toHaveLength(
      leafCount,
    );
    if (leafCount === 4) {
      expect(result.panels.p3.tabs.map((tab) => tab.id)).toEqual(['tab-p3', 'tab-p4']);
    }
  });

  it('flattens vertical leaves in visual reading order', () => {
    const root: PanelLayoutNode = {
      type: 'split',
      direction: 'vertical',
      children: [
        { type: 'panel', panelId: 'top' },
        { type: 'panel', panelId: 'bottom' },
      ],
      sizes: [40, 60],
    };
    const result = migratePanelLayoutForWorkspace(
      WS,
      layout(root, { top: panel('top'), bottom: panel('bottom') }),
    );

    expect(order(result)).toEqual(['top', 'bottom']);
    expect(result.root).toMatchObject({ type: 'split', direction: 'horizontal' });
  });

  it('flattens nested leaves depth-first from top-left to bottom-right', () => {
    const root: PanelLayoutNode = {
      type: 'split',
      direction: 'horizontal',
      children: [
        { type: 'panel', panelId: 'left' },
        {
          type: 'split',
          direction: 'vertical',
          children: [
            { type: 'panel', panelId: 'top-right' },
            { type: 'panel', panelId: 'bottom-right' },
          ],
          sizes: [50, 50],
        },
      ],
      sizes: [50, 50],
    };
    const panels = Object.fromEntries(
      ['left', 'top-right', 'bottom-right'].map((id) => [id, panel(id)]),
    );

    expect(order(migratePanelLayoutForWorkspace(WS, layout(root, panels)))).toEqual([
      'left',
      'top-right',
      'bottom-right',
    ]);
  });

  it('keeps valid content but resets invalid legacy geometry to automatic sizing', () => {
    const stored = layout(horizontal(['p1', 'p2'], [100]), {
      p1: panel('p1'),
      p2: panel('p2'),
    });
    const result = migratePanelLayoutForWorkspace(WS, stored);

    expect(order(result)).toEqual(['p1', 'p2']);
    expect(Object.values(result.panels).flatMap((candidate) => candidate.tabs)).toHaveLength(2);
    expect(result.canvasWidth).toBeNull();
    expect(result.canvasWidthSource).toBeNull();
  });

  it('moves overflow content into rightmost history without duplicates and keeps overflow focus', () => {
    const stored = layout(horizontal(['p1', 'p2', 'p3', 'p4']), {
      p1: panel('p1', ['one']),
      p2: panel('p2', ['two']),
      p3: panel('p3', ['three']),
      p4: panel('p4', ['four', 'two-copy']),
    });
    stored.panels.p4.tabs[1] = { ...stored.panels.p2.tabs[0], id: 'two-copy' };
    stored.panels.p4.activeTabId = 'four';
    stored.focusedPanelId = 'p4';

    const result = migratePanelLayoutForWorkspace(WS, stored);
    const allTabs = Object.values(result.panels).flatMap((candidate) => candidate.tabs);

    expect(result.focusedPanelId).toBe('p3');
    expect(result.panels.p3.activeTabId).toBe('four');
    expect(result.panels.p3.tabs.map((tab) => tab.id)).toEqual(['three', 'four']);
    expect(allTabs.filter((tab) => tab.noteId === 'two')).toHaveLength(1);
  });

  it('restores the versioned fixed layout idempotently without splitting its history', () => {
    const current: WorkspacePanelLayout = {
      ...layout(horizontal(['left', 'right'], [40, 60]), {
        left: panel('left', ['one']),
        right: panel('right', ['two', 'three']),
      }),
      version: PANEL_LAYOUT_PERSISTENCE_VERSION,
      columnCount: 2,
      focusedPanelId: 'right',
    };

    const once = migratePanelLayoutForWorkspace(WS, current);
    const twice = migratePanelLayoutForWorkspace(WS, once);

    expect(twice).toEqual(once);
    expect(order(twice)).toEqual(['left', 'right']);
    expect(twice.root).toMatchObject({ sizes: [40, 60] });
    expect(twice.canvasWidth).toBe(900);
    expect(twice.panels.right.tabs.map((tab) => tab.id)).toEqual(['two', 'three']);
  });

  it('preserves equivalent current-version tabs with distinct IDs and keeps the active duplicate', () => {
    const duplicatePanel = panel('only', ['original', 'duplicate']);
    duplicatePanel.tabs[1] = {
      ...duplicatePanel.tabs[0],
      id: 'duplicate',
      title: 'Duplicate note',
    };
    duplicatePanel.activeTabId = 'duplicate';
    const current: WorkspacePanelLayout = {
      ...layout(horizontal(['only']), { only: duplicatePanel }),
      version: PANEL_LAYOUT_PERSISTENCE_VERSION,
      columnCount: 1,
    };

    const result = migratePanelLayoutForWorkspace(WS, current);

    expect(result.panels.only.tabs.map((tab) => tab.id)).toEqual(['original', 'duplicate']);
    expect(result.panels.only.activeTabId).toBe('duplicate');
  });

  it('preserves equivalent current-version tabs while repairing malformed geometry', () => {
    const duplicatePanel = panel('right', ['original', 'duplicate']);
    duplicatePanel.tabs[1] = { ...duplicatePanel.tabs[0], id: 'duplicate' };
    const current: WorkspacePanelLayout = {
      ...layout(horizontal(['left', 'right'], [95, 5]), {
        left: panel('left'),
        right: duplicatePanel,
      }),
      version: PANEL_LAYOUT_PERSISTENCE_VERSION,
      columnCount: 2,
    };

    const result = migratePanelLayoutForWorkspace(WS, current);

    expect(result.panels.right.tabs.map((tab) => tab.id)).toEqual(['original', 'duplicate']);
    expect(result.root).toMatchObject({ sizes: [50, 50] });
  });

  it('always removes duplicate tab IDs', () => {
    for (const version of [undefined, PANEL_LAYOUT_PERSISTENCE_VERSION]) {
      const duplicatePanel = panel('only', ['same', 'same']);
      const stored: WorkspacePanelLayout = {
        ...layout(horizontal(['only']), { only: duplicatePanel }),
        ...(version === undefined ? {} : { version, columnCount: 1 as const }),
      };

      const result = migratePanelLayoutForWorkspace(WS, stored);

      expect(result.panels.only.tabs.map((tab) => tab.id)).toEqual(['same']);
    }
  });

  it('continues to remove equivalent legacy tabs with distinct IDs', () => {
    const duplicatePanel = panel('only', ['original', 'duplicate']);
    duplicatePanel.tabs[1] = { ...duplicatePanel.tabs[0], id: 'duplicate' };

    const result = migratePanelLayoutForWorkspace(
      WS,
      layout(horizontal(['only']), { only: duplicatePanel }),
    );

    expect(result.panels.only.tabs.map((tab) => tab.id)).toEqual(['original']);
  });

  it('preserves equivalent current-version tabs when repairing overflow', () => {
    const current: WorkspacePanelLayout = {
      ...layout(horizontal(['p1', 'p2', 'p3', 'p4']), {
        p1: panel('p1', ['one']),
        p2: panel('p2', ['two']),
        p3: panel('p3', ['three']),
        p4: panel('p4', ['two-copy']),
      }),
      version: PANEL_LAYOUT_PERSISTENCE_VERSION,
      columnCount: 3,
      focusedPanelId: 'p4',
    };
    current.panels.p4.tabs[0] = { ...current.panels.p2.tabs[0], id: 'two-copy' };

    const result = migratePanelLayoutForWorkspace(WS, current);

    expect(result.panels.p3.tabs.map((tab) => tab.id)).toEqual(['three', 'two-copy']);
    expect(result.panels.p3.activeTabId).toBe('two-copy');
  });

  it('merges an orphan into the rightmost current column without increasing the saved count', () => {
    const current: WorkspacePanelLayout = {
      ...layout(horizontal(['left', 'right']), {
        left: panel('left', ['one']),
        right: panel('right', ['two']),
        orphan: panel('orphan', ['recovered']),
      }),
      version: PANEL_LAYOUT_PERSISTENCE_VERSION,
      columnCount: 2,
      focusedPanelId: 'left',
    };

    const result = migratePanelLayoutForWorkspace(WS, current);

    expect(order(result)).toEqual(['left', 'right']);
    expect(result.columnCount).toBe(2);
    expect(result.panels.right.tabs.map((tab) => tab.id)).toEqual(['two', 'recovered']);
    expect(Object.keys(result.panels)).toEqual(['left', 'right']);
    expect(result.focusedPanelId).toBe('left');
  });

  it('remaps focused orphan content and its active tab to the rightmost current column', () => {
    const orphan = panel('orphan', ['recovered-one', 'recovered-two']);
    orphan.activeTabId = 'recovered-two';
    const current: WorkspacePanelLayout = {
      ...layout(horizontal(['left', 'right']), {
        left: panel('left', ['one']),
        right: panel('right', ['two']),
        orphan,
      }),
      version: PANEL_LAYOUT_PERSISTENCE_VERSION,
      columnCount: 2,
      focusedPanelId: 'orphan',
    };

    const result = migratePanelLayoutForWorkspace(WS, current);

    expect(result.focusedPanelId).toBe('right');
    expect(result.panels.right.activeTabId).toBe('recovered-two');
    expect(result.panels.right.tabs.map((tab) => tab.id)).toEqual([
      'two',
      'recovered-one',
      'recovered-two',
    ]);
  });

  it('fills missing current columns with pristine structural panels', () => {
    const current: WorkspacePanelLayout = {
      ...layout(horizontal(['left', 'right']), {
        left: panel('left', ['one']),
        right: panel('right', ['two']),
      }),
      version: PANEL_LAYOUT_PERSISTENCE_VERSION,
      columnCount: 3,
      focusedPanelId: 'left',
    };

    const result = migratePanelLayoutForWorkspace(WS, current);
    const panelIds = order(result);

    expect(panelIds).toHaveLength(3);
    expect(result.columnCount).toBe(3);
    expect(panelIds.slice(0, 2)).toEqual(['left', 'right']);
    expect(result.panels[panelIds[2]]).toEqual({
      id: panelIds[2],
      tabs: [],
      activeTabId: null,
      pristine: true,
    });
    expect(Object.keys(result.panels)).toEqual(panelIds);
  });

  it('preserves four current columns while repairing invalid geometry', () => {
    const ids = ['p1', 'p2', 'p3', 'p4'];
    const current: WorkspacePanelLayout = {
      ...layout(
        horizontal(ids, [25, 25, 5, 45]),
        Object.fromEntries(ids.map((id) => [id, panel(id)])),
      ),
      version: PANEL_LAYOUT_PERSISTENCE_VERSION,
      columnCount: 4,
      focusedPanelId: 'p4',
    };

    const result = migratePanelLayoutForWorkspace(WS, current);

    expect(order(result)).toEqual(ids);
    expect(result.columnCount).toBe(4);
    expect(result.focusedPanelId).toBe('p4');
    expect(result.root).toMatchObject({ sizes: [25, 25, 25, 25] });
    expect(Object.keys(result.panels)).toEqual(ids);
  });

  it('repairs current layouts with a collapsed saved column', () => {
    const current: WorkspacePanelLayout = {
      ...layout(horizontal(['left', 'middle', 'right'], [25, 5, 70]), {
        left: panel('left', ['one']),
        middle: panel('middle', ['two']),
        right: panel('right', ['three']),
      }),
      version: PANEL_LAYOUT_PERSISTENCE_VERSION,
      columnCount: 3,
      canvasWidth: 3000,
      canvasWidthSource: 'explicit',
    };

    const result = migratePanelLayoutForWorkspace(WS, current);

    expect(order(result)).toEqual(['left', 'middle', 'right']);
    expect(result.root).toMatchObject({
      type: 'split',
      direction: 'horizontal',
      sizes: [100 / 3, 100 / 3, 100 / 3],
    });
    expect(result.canvasWidth).toBeNull();
    expect(result.canvasWidthSource).toBeNull();
    expect(migratePanelLayoutForWorkspace(WS, result)).toEqual(result);
  });

  it('aligns a current saved column count when its tree has fewer columns', () => {
    const current: WorkspacePanelLayout = {
      ...layout(horizontal(['left']), { left: panel('left', ['one']) }),
      version: PANEL_LAYOUT_PERSISTENCE_VERSION,
      columnCount: 2,
      focusedPanelId: 'left',
    };

    const result = migratePanelLayoutForWorkspace(WS, current);

    expect(result.columnCount).toBe(2);
    expect(order(result)).toHaveLength(2);
    expect(order(result)[0]).toBe('left');
    expect(result.panels.left.tabs.map((tab) => tab.id)).toEqual(['one']);
    expect(result.focusedPanelId).toBe('left');
    expect(Object.keys(result.panels)).toEqual(order(result));
  });

  it('continues to derive legacy column counts from the migrated structure', () => {
    const legacy: WorkspacePanelLayout = {
      ...layout(horizontal(['left']), { left: panel('left', ['one']) }),
      columnCount: 2,
    };

    const result = migratePanelLayoutForWorkspace(WS, legacy);

    expect(result.columnCount).toBe(1);
    expect(order(result)).toEqual(['left']);
  });

  it('drops foreign tabs without changing non-coordinator lifecycle metadata', () => {
    const stored: WorkspacePanelLayout = {
      ...layout(horizontal(['p1']), { p1: panel('p1', ['local', 'foreign']) }),
      newWorkspaceLifecycle: {
        coordinator: false,
        initialAgentId: 'agent-1',
        initialAgentPending: false,
        spec: { noteId: 'spec', generation: null, state: 'deferred' },
      },
    };
    stored.panels.p1.tabs[1] = { ...stored.panels.p1.tabs[1], workspaceId: 'other' };

    const result = migratePanelLayoutForWorkspace(WS, stored);

    expect(result.panels.p1.tabs.map((tab) => tab.id)).toEqual(['local']);
    expect(result.newWorkspaceLifecycle?.coordinator).toBe(false);
  });
});
