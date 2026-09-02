import { describe, expect, it } from 'vitest';
import { findEquivalentPanelTab, panelTabsAreEquivalent } from './panel-tab-identity';
import type { PanelTab, WorkspacePanelLayoutState } from './panel-layout-types';

const tab = (id: string, values: Partial<PanelTab>): PanelTab => ({
  id,
  type: 'file',
  title: id,
  closable: true,
  workspaceId: 'ws-1',
  ...values,
});

describe('panel tab canonical identity', () => {
  it('normalizes file paths and keeps terminal identities distinct', () => {
    expect(
      panelTabsAreEquivalent(tab('f', { filePath: '/repo/src/a.ts' }), {
        type: 'file',
        title: 'a',
        closable: true,
        workspaceId: 'ws-1',
        filePath: '/repo/src/./x/../a.ts',
      }),
    ).toBe(true);
    expect(
      panelTabsAreEquivalent(tab('t', { type: 'terminal', terminalId: 'one' }), {
        type: 'terminal',
        title: 'shell',
        closable: true,
        workspaceId: 'ws-1',
        terminalId: 'two',
      }),
    ).toBe(false);
    expect(
      panelTabsAreEquivalent(tab('s', { type: 'terminal', scriptId: 'dev' }), {
        type: 'terminal',
        title: 'Dev server',
        closable: true,
        workspaceId: 'ws-1',
        scriptId: 'dev',
      }),
    ).toBe(true);
  });

  it('uses workspace and hook identity for hook script panels', () => {
    const existing = tab('hook', {
      type: 'hook-script',
      workspaceId: 'ws-1',
      hookId: 'hook-1',
    });
    expect(
      panelTabsAreEquivalent(existing, {
        type: 'hook-script',
        title: 'Hook',
        closable: true,
        workspaceId: 'ws-1',
        hookId: 'hook-1',
      }),
    ).toBe(true);
    expect(
      panelTabsAreEquivalent(existing, {
        type: 'hook-script',
        title: 'Other hook',
        closable: true,
        workspaceId: 'ws-1',
        hookId: 'hook-2',
      }),
    ).toBe(false);
  });

  it('selects the nearest active equivalent in deterministic layout order', () => {
    const requested = {
      type: 'file' as const,
      title: 'a',
      closable: true,
      workspaceId: 'ws-1',
      filePath: 'src/a.ts',
    };
    const workspace = {
      root: {
        type: 'split',
        direction: 'horizontal',
        sizes: [50, 50],
        children: [
          { type: 'panel', panelId: 'left' },
          { type: 'panel', panelId: 'right' },
        ],
      },
      panels: {
        left: {
          id: 'left',
          tabs: [tab('left-a', { filePath: 'src/a.ts' })],
          activeTabId: 'left-a',
        },
        right: {
          id: 'right',
          tabs: [tab('right-a', { filePath: 'src/a.ts' })],
          activeTabId: 'right-a',
        },
      },
      focusedPanelId: 'right',
    } as Pick<WorkspacePanelLayoutState, 'root' | 'panels' | 'focusedPanelId'>;
    expect(findEquivalentPanelTab('ws-1', workspace, requested)?.panelId).toBe('right');
  });

  it('rejects cross-workspace requests', () => {
    const workspace = {
      root: { type: 'panel', panelId: 'p' },
      panels: { p: { id: 'p', tabs: [], activeTabId: null } },
      focusedPanelId: 'p',
    } as Pick<WorkspacePanelLayoutState, 'root' | 'panels' | 'focusedPanelId'>;
    expect(
      findEquivalentPanelTab('ws-1', workspace, {
        type: 'overview',
        title: 'x',
        closable: true,
        workspaceId: 'ws-2',
      }),
    ).toBeNull();
  });
});
