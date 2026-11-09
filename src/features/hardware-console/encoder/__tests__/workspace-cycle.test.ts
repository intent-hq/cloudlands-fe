import { describe, expect, it } from 'vitest';
import { stepWorkspaceTab } from '../workspace-cycle';

describe('stepWorkspaceTab', () => {
  const tabs = ['left', 'middle', 'right'];

  it('moves clockwise to the right and counter-clockwise to the left', () => {
    expect(stepWorkspaceTab(tabs, 'left', 'clockwise')).toBe('middle');
    expect(stepWorkspaceTab(tabs, 'middle', 'clockwise')).toBe('right');
    expect(stepWorkspaceTab(tabs, 'right', 'counterclockwise')).toBe('middle');
    expect(stepWorkspaceTab(tabs, 'middle', 'counterclockwise')).toBe('left');
  });

  it('stops at both ends instead of wrapping', () => {
    expect(stepWorkspaceTab(tabs, 'right', 'clockwise')).toBeNull();
    expect(stepWorkspaceTab(tabs, 'left', 'counterclockwise')).toBeNull();
  });

  it('enters from outside the strip at the end the turn points to', () => {
    expect(stepWorkspaceTab(tabs, null, 'clockwise')).toBe('left');
    expect(stepWorkspaceTab(tabs, null, 'counterclockwise')).toBe('right');
    expect(stepWorkspaceTab(tabs, 'closed', 'clockwise')).toBe('left');
  });

  it('returns null with no tabs or a single current tab', () => {
    expect(stepWorkspaceTab([], null, 'clockwise')).toBeNull();
    expect(stepWorkspaceTab(['only'], 'only', 'clockwise')).toBeNull();
    expect(stepWorkspaceTab(['only'], 'only', 'counterclockwise')).toBeNull();
  });
});
