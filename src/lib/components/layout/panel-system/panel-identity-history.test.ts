import { describe, expect, it } from 'vitest';
import type { PanelTab } from '$store/renderer/slices/panel-layout/panel-layout-types';
import {
  filterPanelTabs,
  getAdjacentPanelTabId,
  getDistinctPanelIdentityValue,
  getPanelIdentityContext,
  PANEL_IDENTITY_SEARCH_THRESHOLD,
} from './panel-identity-history';

const tabs = [
  { id: 'agent', type: 'agent', title: 'Build agent', closable: true },
  { id: 'note', type: 'note', title: 'Release plan', closable: true },
  { id: 'browser', type: 'browser', title: 'Preview', closable: true },
] satisfies PanelTab[];

describe('panel identity history helpers', () => {
  it('navigates only within the existing stable tab order', () => {
    expect(getAdjacentPanelTabId(tabs, 'note', -1)).toBe('agent');
    expect(getAdjacentPanelTabId(tabs, 'note', 1)).toBe('browser');
    expect(getAdjacentPanelTabId(tabs, 'agent', -1)).toBeNull();
    expect(getAdjacentPanelTabId(tabs, 'missing', 1)).toBeNull();
  });

  it('filters titles and types without changing source or result order', () => {
    const result = filterPanelTabs(tabs, 'release NOTE', (tab) => tab.title);
    expect(result.map((tab) => tab.id)).toEqual(['note']);
    expect(filterPanelTabs(tabs, '', (tab) => tab.title).map((tab) => tab.id)).toEqual([
      'agent',
      'note',
      'browser',
    ]);
    expect(tabs.map((tab) => tab.id)).toEqual(['agent', 'note', 'browser']);
    expect(PANEL_IDENTITY_SEARCH_THRESHOLD).toBe(6);
  });

  it('keeps only context that adds information to the panel title', () => {
    expect(getPanelIdentityContext('AGENTS.md', 'AGENTS.md')).toBeNull();
    expect(getPanelIdentityContext('AGENTS.md', '/workspace/AGENTS.md')).toBe('/workspace');
    expect(getPanelIdentityContext('Preview', 'https://example.com/preview')).toBe(
      'https://example.com/preview',
    );
    expect(getPanelIdentityContext('Release plan', null)).toBeNull();
  });

  it('omits empty and duplicate agent metadata values', () => {
    expect(getDistinctPanelIdentityValue('Implementor', ['Build agent'])).toBe('Implementor');
    expect(getDistinctPanelIdentityValue(' build AGENT ', ['Build agent'])).toBeNull();
    expect(
      getDistinctPanelIdentityValue('Scoped implementation', ['Build agent', 'Implementor']),
    ).toBe('Scoped implementation');
    expect(getDistinctPanelIdentityValue('  ', ['Build agent'])).toBeNull();
  });
});
