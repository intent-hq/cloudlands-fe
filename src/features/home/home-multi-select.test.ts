import { describe, expect, it } from 'vitest';
import { WorkspaceStatusEnum, type Workspace } from '$shared/types';
import { homeBulkTargets, toggleHomeSelection } from './home-multi-select';

const row = (id: string, status = WorkspaceStatusEnum.Active) => ({ id, status }) as Workspace;

describe('toggleHomeSelection', () => {
  it('selects a single row when nothing is selected', () => {
    expect(toggleHomeSelection({ multi: [], selectedId: null }, 'a')).toEqual({
      multi: [],
      selectedId: 'a',
    });
  });

  it('clears the single selection when the selected row is toggled', () => {
    expect(toggleHomeSelection({ multi: [], selectedId: 'a' }, 'a')).toEqual({
      multi: [],
      selectedId: null,
    });
  });

  it('starts a multi-selection from the selected row and closes its preview', () => {
    expect(toggleHomeSelection({ multi: [], selectedId: 'a' }, 'b')).toEqual({
      multi: ['a', 'b'],
      selectedId: null,
    });
  });

  it('adds and removes rows while several are selected', () => {
    expect(toggleHomeSelection({ multi: ['a', 'b'], selectedId: null }, 'c')).toEqual({
      multi: ['a', 'b', 'c'],
      selectedId: null,
    });
    expect(toggleHomeSelection({ multi: ['a', 'b', 'c'], selectedId: null }, 'b')).toEqual({
      multi: ['a', 'c'],
      selectedId: null,
    });
  });

  it('falls back to a single selection when one row is left', () => {
    expect(toggleHomeSelection({ multi: ['a', 'b'], selectedId: null }, 'a')).toEqual({
      multi: [],
      selectedId: 'b',
    });
  });
});

describe('homeBulkTargets', () => {
  const rows = [
    row('live'),
    row('archived', WorkspaceStatusEnum.Archived),
    row('purged', WorkspaceStatusEnum.Retired),
    row('shared'),
  ];
  const targets = homeBulkTargets(rows, (workspace) => workspace.id !== 'shared');
  const ids = (items: Workspace[]) => items.map((workspace) => workspace.id);

  it('archives only live rows the user manages', () => {
    expect(ids(targets.archive)).toEqual(['live']);
  });

  it('purges only archived rows that still have a folder', () => {
    expect(ids(targets.purge)).toEqual(['archived']);
  });

  it('deletes every row the user manages, archived or purged', () => {
    expect(ids(targets.delete)).toEqual(['live', 'archived', 'purged']);
  });
});
