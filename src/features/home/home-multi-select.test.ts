import { describe, expect, it } from 'vitest';
import { WorkspaceStatusEnum, type Workspace } from '$shared/types';
import { homeBulkTargets, rangeHomeSelection, toggleHomeSelection } from './home-multi-select';

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

describe('rangeHomeSelection', () => {
  const order = ['a', 'b', 'c', 'd', 'e'];

  it('selects every row from the anchor to the clicked row, in screen order', () => {
    expect(rangeHomeSelection(order, 'b', 'd')).toEqual({
      multi: ['b', 'c', 'd'],
      selectedId: null,
    });
  });

  it('selects upward ranges in screen order too', () => {
    expect(rangeHomeSelection(order, 'd', 'a')).toEqual({
      multi: ['a', 'b', 'c', 'd'],
      selectedId: null,
    });
  });

  it('falls back to a single selection for a one-row range', () => {
    expect(rangeHomeSelection(order, 'c', 'c')).toEqual({ multi: [], selectedId: 'c' });
  });

  it('acts like a plain click without an anchor, or when the anchor left the screen', () => {
    expect(rangeHomeSelection(order, null, 'c')).toEqual({ multi: [], selectedId: 'c' });
    expect(rangeHomeSelection(order, 'gone', 'c')).toEqual({ multi: [], selectedId: 'c' });
  });
});

describe('homeBulkTargets', () => {
  const rows = [
    row('live'),
    row('archived', WorkspaceStatusEnum.Archived),
    row('purged', WorkspaceStatusEnum.Retired),
    row('shared'),
    { ...row('folder'), plainFolder: true } as Workspace,
  ];
  const targets = homeBulkTargets(rows, (workspace) => workspace.id !== 'shared');
  const ids = (items: Workspace[]) => items.map((workspace) => workspace.id);

  it('archives only live rows the user manages', () => {
    expect(ids(targets.archive)).toEqual(['live', 'folder']);
  });

  it('purges only archived rows that still have a folder', () => {
    expect(ids(targets.purge)).toEqual(['archived']);
  });

  it('deletes every row the user manages, archived or purged', () => {
    expect(ids(targets.delete)).toEqual(['live', 'archived', 'purged', 'folder']);
  });

  it('transfers managed rows that still have a git checkout', () => {
    expect(ids(targets.transfer)).toEqual(['live', 'archived']);
  });
});
