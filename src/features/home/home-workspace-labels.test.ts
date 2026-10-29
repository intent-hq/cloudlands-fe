import { describe, expect, it } from 'vitest';
import type { Workspace } from '$shared/types';
import { labelWorkspace } from '../../test/fixtures/workspace-labels-state';
import { buildHomeListGroups, homeLabelGroupKey } from './home-workspace-labels';

const ws = (id: string, label?: string | null): Workspace =>
  labelWorkspace(id, label === undefined ? {} : { label });

const a = ws('a');
const b = ws('b', 'pinned');
const c = ws('c', 'For Later');
const d = ws('d', 'Backlog');
const e = ws('e', 'for later');
const f = ws('f');
const workspaces = [a, b, c, d, e, f];

const started = new Set(['a', 'b', 'c']);

function build(overrides: Partial<Parameters<typeof buildHomeListGroups>[0]> = {}) {
  const visible = overrides.workspaces ?? workspaces;
  return buildHomeListGroups({
    groupBy: 'workspace-status',
    filter: 'all',
    baseGroups: [
      {
        id: 'status:in_progress',
        label: 'In progress',
        items: visible.filter((w) => started.has(w.id)),
      },
      {
        id: 'status:not_started',
        label: 'Not started',
        items: visible.filter((w) => !started.has(w.id)),
      },
    ],
    workspaces,
    pinnedIds: ['b'],
    labels: ['Backlog', 'For Later'],
    labelsSupported: true,
    pinnedLabel: 'Pinned',
    expandedGroups: {},
    selectedId: null,
    ...overrides,
  });
}

const summary = (groups: ReturnType<typeof build>) =>
  groups.map((group) => [group.id, group.items.map((item) => item.id)]);

describe('buildHomeListGroups', () => {
  it('orders Pinned, then custom labels A–Z, then the base groups without those rows', () => {
    expect(summary(build())).toEqual([
      ['pinned', ['b']],
      ['label:Backlog', ['d']],
      ['label:For Later', ['c', 'e']],
      ['status:in_progress', ['a']],
      ['status:not_started', ['f']],
    ]);
    expect(build().map((group) => group.label)).toEqual([
      'Pinned',
      'Backlog',
      'For Later',
      'In progress',
      'Not started',
    ]);
  });

  it('keeps the workspace order inside a group', () => {
    const groups = build({ workspaces: [e, f, c, a, b, d] });
    expect(groups.find((group) => group.id === 'label:For Later')?.items).toEqual([e, c]);
  });

  it('uses the shared expansion key and collapses only on an explicit false', () => {
    expect(homeLabelGroupKey('For Later')).toBe('label:For Later');
    const groups = build({ expandedGroups: { 'label:Backlog': false, pinned: true } });
    expect(groups.map((group) => [group.id, group.expanded])).toEqual([
      ['pinned', true],
      ['label:Backlog', false],
      ['label:For Later', true],
      ['status:in_progress', true],
      ['status:not_started', true],
    ]);
    expect(groups.every((group) => group.collapsible)).toBe(true);
  });

  it('keeps a collapsed group open while it holds the selection', () => {
    const groups = build({ expandedGroups: { 'label:Backlog': false }, selectedId: 'd' });
    expect(groups.find((group) => group.id === 'label:Backlog')?.expanded).toBe(true);
  });

  it('drops a label group once no visible workspace holds it', () => {
    const groups = build({ workspaces: [a, b, c, e, f] });
    expect(groups.map((group) => group.id)).not.toContain('label:Backlog');
    const relabeled = build({ workspaces: [a, b, ws('d'), f] });
    expect(summary(relabeled)).toEqual([
      ['pinned', ['b']],
      ['status:in_progress', ['a']],
      ['status:not_started', ['d', 'f']],
    ]);
  });

  it('names a group by the in-use spelling even when another row comes first', () => {
    const groups = build({ workspaces: [e, c] });
    expect(groups.map((group) => [group.id, group.label])).toEqual([
      ['label:For Later', 'For Later'],
    ]);
  });

  it('shows Pinned from local pins and no label groups on older daemons', () => {
    expect(summary(build({ labelsSupported: false, pinnedIds: ['a'] }))).toEqual([
      ['pinned', ['a']],
      ['status:in_progress', ['b', 'c']],
      ['status:not_started', ['d', 'e', 'f']],
    ]);
  });

  it('ignores blank labels', () => {
    const blank = ws('blank', '  ');
    const groups = build({
      workspaces: [blank],
      baseGroups: [{ id: 'status:idle', label: 'Idle', items: [blank] }],
      pinnedIds: [],
    });
    expect(summary(groups)).toEqual([['status:idle', ['blank']]]);
  });

  it('shows no groups for Group by None or a filtered Activity grouping', () => {
    expect(build({ groupBy: 'none' })).toEqual([]);
    expect(build({ groupBy: 'status', filter: 'running' })).toEqual([]);
    expect(build({ groupBy: 'status' }).map((group) => group.id)[0]).toBe('pinned');
    expect(build({ groupBy: 'repository', filter: 'running' })).toHaveLength(5);
  });
});
