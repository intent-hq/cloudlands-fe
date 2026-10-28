import { describe, expect, it } from 'vitest';

import {
  labelWorkspace,
  workspaceLabelsState,
} from '../../../../test/fixtures/workspace-labels-state';
import { removeWorkspaceEntity, workspaceReducer } from '../workspace/workspace-slice';
import {
  selectCanSetWorkspaceLabel,
  selectLabelsSupported,
  selectLocalPinnedWorkspaceIds,
  selectPinnedWorkspaceIds,
  selectWorkspaceLabel,
  selectWorkspaceLabelsInUse,
} from './sidebar-nav-selectors';
import {
  collectCustomWorkspaceLabels,
  PINNED_WORKSPACE_LABEL,
  validateWorkspaceLabelName,
  WORKSPACE_LABEL_MAX_LENGTH,
} from './workspace-labels';

describe('validateWorkspaceLabelName', () => {
  it('accepts a trimmed unique name', () => {
    expect(validateWorkspaceLabelName('  For Later  ', ['Review'])).toEqual({
      ok: true,
      label: 'For Later',
    });
  });

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['x'.repeat(WORKSPACE_LABEL_MAX_LENGTH + 1), 'tooLong'],
    ['Pinned', 'reserved'],
    [' PINNED ', 'reserved'],
    ['pinned', 'reserved'],
    ['for later', 'duplicate'],
    [' FOR LATER', 'duplicate'],
  ] as const)('rejects %j as %s', (name, error) => {
    expect(validateWorkspaceLabelName(name, ['For Later'])).toEqual({ ok: false, error });
  });

  it('allows exactly 64 characters, counting code points', () => {
    expect(validateWorkspaceLabelName('x'.repeat(64), []).ok).toBe(true);
    expect(validateWorkspaceLabelName('😀'.repeat(64), []).ok).toBe(true);
    expect(validateWorkspaceLabelName('😀'.repeat(65), [])).toEqual({
      ok: false,
      error: 'tooLong',
    });
  });
});

describe('collectCustomWorkspaceLabels', () => {
  it('dedupes ignoring case, drops Pinned and blanks, and sorts A–Z', () => {
    expect(
      collectCustomWorkspaceLabels([
        'zeta',
        PINNED_WORKSPACE_LABEL,
        undefined,
        'Alpha',
        null,
        'alpha',
        '  ',
        'Beta',
      ]),
    ).toEqual(['Alpha', 'Beta', 'zeta']);
  });
});

describe('workspace label selectors', () => {
  const rows = [
    labelWorkspace('ws-pinned', { label: PINNED_WORKSPACE_LABEL }),
    labelWorkspace('ws-later', { label: 'For Later' }),
    labelWorkspace('ws-archived', { label: 'Archive me', archived: true }),
    labelWorkspace('ws-plain'),
  ];

  it('reads one workspace label, or null', () => {
    const state = workspaceLabelsState({ workspaces: rows });
    expect(selectWorkspaceLabel.select(state, 'ws-later')).toBe('For Later');
    expect(selectWorkspaceLabel.select(state, 'ws-plain')).toBeNull();
    expect(selectWorkspaceLabel.select(state, 'missing')).toBeNull();
  });

  it('lists the custom labels held by workspaces, archived included', () => {
    const state = workspaceLabelsState({ workspaces: rows });
    expect(selectWorkspaceLabelsInUse.select(state)).toEqual(['Archive me', 'For Later']);
  });

  it('drops a label once its last workspace is deleted', () => {
    const state = workspaceLabelsState({ workspaces: rows });
    const after = {
      ...state,
      workspace: workspaceReducer(state.workspace, removeWorkspaceEntity('ws-later')),
    };
    expect(selectWorkspaceLabelsInUse.select(after)).toEqual(['Archive me']);
  });

  it('derives pins from the "pinned" label when the daemon supports labels', () => {
    const state = workspaceLabelsState({ workspaces: rows, pinned: ['ws-plain'] });
    expect(selectLabelsSupported.select(state)).toBe(true);
    expect(selectPinnedWorkspaceIds.select(state)).toEqual(['ws-pinned']);
    expect(selectLocalPinnedWorkspaceIds.select(state)).toEqual(['ws-plain']);
  });

  it('falls back to local pins on a daemon without label support', () => {
    const state = workspaceLabelsState({
      workspaces: rows,
      pinned: ['ws-plain'],
      supported: false,
    });
    expect(selectLabelsSupported.select(state)).toBe(false);
    expect(selectPinnedWorkspaceIds.select(state)).toEqual(['ws-plain']);
    expect(selectCanSetWorkspaceLabel.select(state, 'ws-plain')).toBe(false);
  });

  it('lets only a workspace manager set labels', () => {
    const owner = workspaceLabelsState({ workspaces: rows });
    expect(selectCanSetWorkspaceLabel.select(owner, 'ws-plain')).toBe(true);
    const guest = workspaceLabelsState({
      workspaces: [labelWorkspace('ws-shared', { myRole: 'collaborator' })],
      role: 'guest',
    });
    expect(selectCanSetWorkspaceLabel.select(guest, 'ws-shared')).toBe(false);
  });
});
