import { describe, expect, it } from 'vitest';
import type { PanelTab } from '$store/renderer/slices/panel-layout/panel-layout-types';
import { filterPanelTabs, getAdjacentPanelTabId } from './panel-identity-history';

const tabs = [
  { id: 'agent', type: 'agent', title: 'Build agent', closable: true },
  { id: 'note', type: 'note', title: 'Release plan', closable: true },
  { id: 'browser', type: 'browser', title: 'Preview', closable: true },
  { id: 'terminal', type: 'terminal', title: 'Server', closable: true },
] satisfies PanelTab[];

describe('panel identity history helpers', () => {
  it('maps previous and next asymmetrically within the stable tab order', () => {
    expect(getAdjacentPanelTabId(tabs, 'note', -1)).toBe('agent');
    expect(getAdjacentPanelTabId(tabs, 'note', 1)).toBe('browser');
    expect(getAdjacentPanelTabId(tabs, 'agent', -1)).toBeNull();
    expect(getAdjacentPanelTabId(tabs, 'terminal', 1)).toBeNull();
    expect(getAdjacentPanelTabId(tabs, 'missing', 1)).toBeNull();
  });

  it('filters titles and types without changing source or result order', () => {
    const result = filterPanelTabs(tabs, 'release NOTE', (tab) => tab.title);
    expect(result.map((tab) => tab.id)).toEqual(['note']);
    expect(filterPanelTabs(tabs, '', (tab) => tab.title).map((tab) => tab.id)).toEqual([
      'agent',
      'note',
      'browser',
      'terminal',
    ]);
    expect(tabs.map((tab) => tab.id)).toEqual(['agent', 'note', 'browser', 'terminal']);
  });
});
