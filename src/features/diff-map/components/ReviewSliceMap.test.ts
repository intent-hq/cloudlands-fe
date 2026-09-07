/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tinyDiffMapFixture } from '../model/fixtures';
import ReviewSliceMap from './ReviewSliceMap.svelte';

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

afterEach(() => {
  cleanup();
  mocks.dispatch.mockClear();
  mocks.launch.mockClear();
});

describe('ReviewSliceMap', () => {
  it('sends exactly the paths selected through the map to ReviewSliceAction', async () => {
    const { container } = render(ReviewSliceMap, {
      props: {
        workspaceId: 'ws-1',
        document: tinyDiffMapFixture.document,
        onOpen: vi.fn(),
      },
    });
    await waitFor(() => expect(container.querySelectorAll('[data-diff-map-row]')).toHaveLength(3));
    const rows = [...container.querySelectorAll<HTMLButtonElement>('[data-diff-map-row]')];

    await fireEvent.click(rows[0], { ctrlKey: true });
    await fireEvent.click(rows[2], { ctrlKey: true });
    const askAgent = screen.getByRole<HTMLButtonElement>('button', {
      name: /ask agent/i,
    });
    await waitFor(() => expect(askAgent.disabled).toBe(false));
    await fireEvent.click(askAgent);
    await waitFor(() => expect(mocks.dispatch).toHaveBeenCalledOnce());

    const config = mocks.launch.mock.calls[0][1] as {
      contextReferences: Array<{ metadata: { reviewSlice: { entries: Array<{ path: string }> } } }>;
    };
    expect(
      config.contextReferences[0].metadata.reviewSlice.entries.map(({ path }) => path),
    ).toEqual([
      tinyDiffMapFixture.document.files[0].path,
      tinyDiffMapFixture.document.files[2].path,
    ]);
  });
});
