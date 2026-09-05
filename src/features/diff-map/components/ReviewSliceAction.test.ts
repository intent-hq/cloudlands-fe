import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { tinyDiffMapFixture } from '../model/fixtures';
import ReviewSliceAction from './ReviewSliceAction.svelte';

const mocks = vi.hoisted(() => {
  const dispatch = vi.fn();
  const launch = vi.fn((...payload: unknown[]) => ({
    type: 'agentSessions/launchAgentRequested',
    payload,
    promise: Promise.resolve({ id: 'review-agent' }),
  }));
  return { dispatch, launch };
});

vi.mock('$store/renderer/store', () => ({ store: { dispatch: mocks.dispatch, state: {} } }));
vi.mock('$store/renderer/slices/agent-session/agent-session-slice', () => ({
  agentSessionLaunchAgentRequested: mocks.launch,
}));

describe('ReviewSliceAction', () => {
  it('launches an agent with the selected files as serialized review context', async () => {
    const paths = tinyDiffMapFixture.document.files.map(({ path }) => path);
    render(ReviewSliceAction, {
      props: {
        workspaceId: 'ws-1',
        document: tinyDiffMapFixture.document,
        selection: new Set(paths),
      },
    });

    await fireEvent.click(screen.getByRole('button', { name: /ask agent/i }));
    await waitFor(() => expect(mocks.dispatch).toHaveBeenCalledOnce());

    const [workspaceId, config, options] = mocks.launch.mock.calls[0];
    const context = (config as { contextReferences: Array<{ content: string }> })
      .contextReferences[0];
    expect(workspaceId).toBe('ws-1');
    expect(options).toEqual({ openAgent: true });
    expect(JSON.parse(context.content)).toMatchObject({
      snapshotId: tinyDiffMapFixture.document.source.snapshotId,
      entries: paths.map((path) => ({ path })),
    });
  });
});
