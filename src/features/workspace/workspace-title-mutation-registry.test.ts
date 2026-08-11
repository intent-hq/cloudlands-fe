import { afterEach, describe, expect, it } from 'vitest';
import type { Workspace } from '$shared/types';
import {
  acknowledgeWorkspaceTitleMutation,
  applyWorkspaceTitleMutationOverlay,
  beginWorkspaceTitleMutation,
  failWorkspaceTitleMutation,
  resetWorkspaceTitleMutationsForTests,
} from './workspace-title-mutation-registry';

const workspace = (id: string, title: string): Workspace =>
  ({ id, title, branch: 'main', statusMessage: 'Daemon status' }) as Workspace;

describe('workspace title mutation registry', () => {
  afterEach(resetWorkspaceTitleMutationsForTests);

  it('overlays only the title and retires after an acknowledged matching snapshot', () => {
    const token = beginWorkspaceTitleMutation('ws-1', 'Optimistic', 'Original');
    const stale = workspace('ws-1', 'Original');

    expect(applyWorkspaceTitleMutationOverlay([stale])).toEqual([
      { ...stale, title: 'Optimistic' },
    ]);
    expect(acknowledgeWorkspaceTitleMutation('ws-1', token, 'Optimistic')).toBe(true);
    expect(applyWorkspaceTitleMutationOverlay([workspace('ws-1', 'Optimistic')])[0]?.title).toBe(
      'Optimistic',
    );
    expect(applyWorkspaceTitleMutationOverlay([workspace('ws-1', 'External')])[0]?.title).toBe(
      'External',
    );
  });

  it('keeps workspace mutations independent and drops entries for deleted workspaces', () => {
    beginWorkspaceTitleMutation('ws-1', 'One', 'Original one');
    beginWorkspaceTitleMutation('ws-2', 'Two', 'Original two');

    const result = applyWorkspaceTitleMutationOverlay([workspace('ws-2', 'Stale two')]);
    expect(result).toEqual([{ ...workspace('ws-2', 'Stale two'), title: 'Two' }]);
    expect(applyWorkspaceTitleMutationOverlay([workspace('ws-1', 'Recreated')])[0]?.title).toBe(
      'Recreated',
    );
  });

  it('retires when a matching snapshot arrives before the update acknowledgement', () => {
    const token = beginWorkspaceTitleMutation('ws-1', 'Optimistic', 'Original');
    applyWorkspaceTitleMutationOverlay([workspace('ws-1', 'Optimistic')]);

    expect(acknowledgeWorkspaceTitleMutation('ws-1', token, 'Optimistic')).toBe(true);
    expect(applyWorkspaceTitleMutationOverlay([workspace('ws-1', 'External')])[0]?.title).toBe(
      'External',
    );
  });

  it('makes the latest token the sole settlement owner and captures its predecessor', () => {
    const first = beginWorkspaceTitleMutation('ws-1', 'First', 'Original');
    const second = beginWorkspaceTitleMutation('ws-1', 'Second', 'Original');

    expect(acknowledgeWorkspaceTitleMutation('ws-1', first, 'First')).toBe(false);
    expect(failWorkspaceTitleMutation('ws-1', first)).toBeUndefined();
    expect(failWorkspaceTitleMutation('ws-1', second)).toEqual({
      optimisticTitle: 'Second',
      previousTitle: 'First',
    });
  });
});
