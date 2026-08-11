import { describe, expect, it } from 'vitest';
import { WorkspaceEventType, type WorkspaceEvent } from '$features/events/types';
import {
  isSourceFileActivityEvent,
  isWorkspaceStatusUpdateEvent,
  shouldShowWorkspaceActivityEvent,
} from './activity-event-visibility';

function workspaceUpdated(changes: Record<string, unknown>): WorkspaceEvent {
  return {
    id: 'event-1',
    workspaceId: 'workspace-1',
    timestamp: '2026-07-28T00:00:00.000Z',
    type: 'workspace:updated',
    actor: { type: 'system' },
    data: { workspaceId: 'workspace-1', changes },
  };
}

describe('activity event visibility', () => {
  it('identifies derived workspace display-status changes', () => {
    expect(
      isWorkspaceStatusUpdateEvent({
        ...workspaceUpdated({}),
        type: WorkspaceEventType.DisplayStatusChanged,
        data: { workspaceId: 'workspace-1', displayStatus: 'in_progress' },
      }),
    ).toBe(true);
  });

  it('identifies status-message-only updates', () => {
    expect(
      isWorkspaceStatusUpdateEvent(workspaceUpdated({ statusMessage: 'Running tests.' })),
    ).toBe(true);
  });

  it('identifies status metadata updates with a last-activity heartbeat', () => {
    expect(
      isWorkspaceStatusUpdateEvent(
        workspaceUpdated({ statusImageAssetId: 'asset-1', lastActivity: '2026-07-28T00:00:00Z' }),
      ),
    ).toBe(true);
  });

  it('preserves meaningful and mixed workspace updates', () => {
    expect(isWorkspaceStatusUpdateEvent(workspaceUpdated({ title: 'New title' }))).toBe(false);
    expect(
      isWorkspaceStatusUpdateEvent(
        workspaceUpdated({ statusMessage: 'Done.', branch: 'feature/activity-filter' }),
      ),
    ).toBe(false);
    expect(isWorkspaceStatusUpdateEvent(workspaceUpdated({ status: 'Archived' }))).toBe(false);
  });

  it('shows only agent, note, task, and source-file activity', () => {
    const event = workspaceUpdated({});
    expect(shouldShowWorkspaceActivityEvent({ ...event, type: 'agent:completed' })).toBe(true);
    expect(shouldShowWorkspaceActivityEvent({ ...event, type: 'note:updated' })).toBe(true);
    expect(shouldShowWorkspaceActivityEvent({ ...event, type: 'task:status-changed' })).toBe(true);
    expect(
      shouldShowWorkspaceActivityEvent({
        ...event,
        type: 'file:changed',
        data: { path: 'src/lib/App.svelte', action: 'modify' },
      }),
    ).toBe(true);
    expect(shouldShowWorkspaceActivityEvent({ ...event, type: 'git:commit' })).toBe(false);
    expect(shouldShowWorkspaceActivityEvent({ ...event, type: 'terminal:command' })).toBe(false);
    expect(shouldShowWorkspaceActivityEvent({ ...event, type: 'script:state' })).toBe(false);
    expect(shouldShowWorkspaceActivityEvent(workspaceUpdated({ title: 'New title' }))).toBe(false);
  });

  it('hides generated, dependency, and browser-automation file activity', () => {
    const event = workspaceUpdated({});
    const fileEvent = (path: string): WorkspaceEvent => ({
      ...event,
      type: 'file:changed',
      data: { path, action: 'modify' },
    });

    expect(isSourceFileActivityEvent(fileEvent('.playwright-cli/console-2026.log'))).toBe(false);
    expect(isSourceFileActivityEvent(fileEvent('node_modules/pkg/index.js'))).toBe(false);
    expect(isSourceFileActivityEvent(fileEvent('dist/renderer/app.js'))).toBe(false);
    expect(isSourceFileActivityEvent(fileEvent('coverage/index.html'))).toBe(false);
    expect(isSourceFileActivityEvent(fileEvent('.github/workflows/ci.yml'))).toBe(true);
    expect(isSourceFileActivityEvent(fileEvent('docs/activity-log.md'))).toBe(true);
  });
});
