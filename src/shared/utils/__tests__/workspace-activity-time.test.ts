import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  compareWorkspaceActivityDisplayTimeDesc,
  getWorkspaceActivityDisplayTime,
  getWorkspaceActivityDisplayTimeInfo,
  isWorkspaceActivityWithin,
  type WorkspaceActivityTimeFields,
} from '../workspace-activity-time';

const oldActivity = '2025-01-01T00:00:00.000Z';
const created = '2024-01-01T00:00:00.000Z';
const freshUpdated = '2026-05-07T15:00:00.000Z';

function workspace(overrides: Partial<WorkspaceActivityTimeFields>): WorkspaceActivityTimeFields {
  return {
    createdAt: created,
    updatedAt: freshUpdated,
    ...overrides,
  };
}

describe('workspace activity display time', () => {
  it('uses semantic lastActivity instead of freshly touched updatedAt', () => {
    const result = getWorkspaceActivityDisplayTimeInfo(
      workspace({ lastActivity: oldActivity, updatedAt: freshUpdated }),
    );

    expect(result).toEqual({ source: 'lastActivity', time: Date.parse(oldActivity) });
  });

  it('falls back to createdAt when lastActivity is missing or invalid', () => {
    expect(getWorkspaceActivityDisplayTimeInfo(workspace({}))).toEqual({
      source: 'createdAt',
      time: Date.parse(created),
    });
    expect(getWorkspaceActivityDisplayTimeInfo(workspace({ lastActivity: 'not-a-date' }))).toEqual({
      source: 'createdAt',
      time: Date.parse(created),
    });
  });

  it('uses updatedAt only when no better valid timestamp exists', () => {
    expect(
      getWorkspaceActivityDisplayTimeInfo(
        workspace({ createdAt: 'not-a-date', updatedAt: freshUpdated }),
      ),
    ).toEqual({ source: 'updatedAt', time: Date.parse(freshUpdated) });
  });

  it('returns zero for invalid timestamps instead of using the current time', () => {
    expect(
      getWorkspaceActivityDisplayTime(
        workspace({ lastActivity: 'bad', createdAt: 'bad', updatedAt: 'bad' }),
      ),
    ).toBe(0);
  });

  it('sorts by display time without allowing updatedAt to outrank older activity', () => {
    const workspaces = [
      workspace({ lastActivity: oldActivity, updatedAt: freshUpdated }),
      workspace({}),
    ];

    const sorted = [...workspaces].sort(compareWorkspaceActivityDisplayTimeDesc);

    expect(sorted[0]).toBe(workspaces[0]);
  });

  it('checks recency windows against display time', () => {
    const now = Date.parse('2026-05-07T16:00:00.000Z');

    expect(
      isWorkspaceActivityWithin(
        workspace({ lastActivity: oldActivity, updatedAt: freshUpdated }),
        now,
        24 * 60 * 60 * 1000,
      ),
    ).toBe(false);
  });
});