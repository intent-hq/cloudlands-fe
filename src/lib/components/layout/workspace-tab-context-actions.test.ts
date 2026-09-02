import { describe, expect, it } from 'vitest';
import { getWorkspaceTabBulkCloseIds } from './workspace-tab-context-actions';

describe('workspace tab context actions', () => {
  const order = ['first', 'middle', 'last'];

  it('closes every tab except the target for Close Others', () => {
    expect(getWorkspaceTabBulkCloseIds(order, 'middle', 'others')).toEqual(['first', 'last']);
  });

  it('closes only ordered tabs to the right', () => {
    expect(getWorkspaceTabBulkCloseIds(order, 'first', 'right')).toEqual(['middle', 'last']);
    expect(getWorkspaceTabBulkCloseIds(order, 'middle', 'right')).toEqual(['last']);
    expect(getWorkspaceTabBulkCloseIds(order, 'last', 'right')).toEqual([]);
  });

  it('does nothing for a missing or sole tab', () => {
    expect(getWorkspaceTabBulkCloseIds(['only'], 'only', 'others')).toEqual([]);
    expect(getWorkspaceTabBulkCloseIds(order, 'missing', 'right')).toEqual([]);
  });
});
