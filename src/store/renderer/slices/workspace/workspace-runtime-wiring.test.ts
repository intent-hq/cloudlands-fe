import { describe, expect, it } from 'vitest';
import {
  cleanupRecency,
  initialState,
  recordWorkspaceView,
  workspaceReducer,
} from './workspace-slice';

describe('workspace recency runtime wiring', () => {
  it('stores recency tracking in the Redux workspace slice', () => {
    const viewed = workspaceReducer(
      workspaceReducer(initialState, recordWorkspaceView('ws-a', 100)),
      recordWorkspaceView('ws-b', 200),
    );
    expect(viewed.recency.lastViewedAt).toEqual({ 'ws-a': 100, 'ws-b': 200 });

    const cleaned = workspaceReducer(viewed, cleanupRecency(['ws-b']));
    expect(cleaned.recency.lastViewedAt).toEqual({ 'ws-b': 200 });
    expect(workspaceReducer(cleaned, cleanupRecency(['ws-b']))).toBe(cleaned);
  });
});
