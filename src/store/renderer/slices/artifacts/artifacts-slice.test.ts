import type { ArtifactSelectionSnapshot } from '$shared/types/visual-artifact';
import { describe, expect, it } from 'vitest';
import {
  artifactsReducer,
  artifactSelectionQueued,
  artifactSelectionConsumed,
  initialState,
} from './artifacts-slice';
import { workspaceUnmounted } from '../workspace-lifecycle/workspace-lifecycle-slice';

const item = {
  id: 'selection-1',
  type: 'selection' as const,
  label: 'Board',
  content: '{"text":"before"}',
};
describe('artifact composer routing', () => {
  it('starts empty and rejects unscoped targets', () => {
    expect(initialState).toEqual({ byWorkspaceId: {} });
    expect(artifactsReducer(initialState, artifactSelectionQueued('w', '', [item]))).toBe(
      initialState,
    );
    expect(artifactsReducer(initialState, artifactSelectionQueued('', 'a', [item]))).toBe(
      initialState,
    );
  });
  it('queues an immutable snapshot until the correct workspace and agent consume it', () => {
    const original = { ...item };
    const state = artifactsReducer(
      initialState,
      artifactSelectionQueued('w', 'agent-a', [original]),
    );
    original.content = 'after';
    expect(state.byWorkspaceId.w.pending['selection-1'].items[0].content).toBe('{"text":"before"}');
    expect(artifactsReducer(state, artifactSelectionConsumed('w', 'agent-b', item.id))).toBe(state);
    expect(artifactsReducer(state, artifactSelectionConsumed('other', 'agent-a', item.id))).toBe(
      state,
    );
    const next = artifactsReducer(state, artifactSelectionConsumed('w', 'agent-a', item.id));
    expect(next.byWorkspaceId.w.pending).toEqual({});
  });
  it('cleans only the unmounted workspace', () => {
    let state = artifactsReducer(initialState, artifactSelectionQueued('w', 'a', [item]));
    state = artifactsReducer(state, artifactSelectionQueued('other', 'b', [item]));
    const next = artifactsReducer(state, workspaceUnmounted('w'));
    expect(next.byWorkspaceId.w).toBeUndefined();
    expect(next.byWorkspaceId.other.pending[item.id].targetAgentId).toBe('b');
  });
});

it('tracks resolved images without reviving an unmounted workspace', async () => {
  const { artifactImagesRequested, artifactImageResolved } = await import('./artifacts-slice');
  let state = artifactsReducer(initialState, artifactImagesRequested('w', ['src']));
  state = artifactsReducer(state, artifactImageResolved('w', 'src', { failed: true }));
  expect(state.byWorkspaceId.w.images.src.failed).toBe(true);
  state = artifactsReducer(
    state,
    artifactImageResolved('w', 'src', { failed: false, dataUrl: 'data:image/png;base64,AA==' }),
  );
  expect(state.byWorkspaceId.w.images.src.dataUrl).toBe('data:image/png;base64,AA==');
  state = artifactsReducer(state, workspaceUnmounted('w'));
  expect(artifactsReducer(state, artifactImageResolved('w', 'src', { failed: true }))).toBe(state);
});

it('preserves typed selection metadata without retaining mutable references', () => {
  const snapshot: ArtifactSelectionSnapshot = {
    version: 1,
    source: { workspaceId: 'w', artifactId: 'a' },
    title: 'Board',
    kind: 'board',
    selection: { itemIds: ['card'] },
    items: [],
    connections: [],
    annotations: [],
    comment: '',
  };
  const metadata = { semanticId: 'artifact:a#items:card', artifactSelection: snapshot };
  const state = artifactsReducer(
    initialState,
    artifactSelectionQueued('w', 'agent', [{ ...item, metadata }]),
  );
  snapshot.selection.itemIds.push('later');
  expect(state.byWorkspaceId.w.pending[item.id].items[0].metadata).toEqual({
    semanticId: 'artifact:a#items:card',
    artifactSelection: { ...snapshot, selection: { itemIds: ['card'] } },
  });
});
