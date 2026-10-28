import { describe, expect, it, vi } from 'vitest';
import { openAgentTabRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
import { openWorkspaceNote } from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
import {
  createWorkspaceDeepLinkConsumer,
  parseWorkspaceDeepLinks,
  stripWorkspaceDeepLinkParams,
} from './workspace-deep-link';

const url = (path: string) => new URL(path, 'http://daemon.localhost:5200');

describe('parseWorkspaceDeepLinks', () => {
  it('reads note and agent ids, note first so the agent chat ends up focused', () => {
    expect(parseWorkspaceDeepLinks(new URLSearchParams('agent=agent-1&note=spec'))).toEqual([
      { kind: 'note', noteId: 'spec' },
      { kind: 'agent', agentId: 'agent-1' },
    ]);
  });

  it.each(['note=', 'note=%20', 'note=..', 'note=a%2Fb', 'agent=a%5Cb', 'other=1'])(
    'ignores an empty, dot or path-like id (%s)',
    (query) => {
      expect(parseWorkspaceDeepLinks(new URLSearchParams(query))).toEqual([]);
    },
  );
});

describe('stripWorkspaceDeepLinkParams', () => {
  it('drops only the deep-link parameters and keeps the rest of the URL', () => {
    expect(stripWorkspaceDeepLinkParams(url('/workspace/ws-1?note=spec&agent=a&keep=1#frag'))).toBe(
      '/workspace/ws-1?keep=1#frag',
    );
    expect(stripWorkspaceDeepLinkParams(url('/workspace/ws-1?note=spec'))).toBe('/workspace/ws-1');
  });
});

describe('createWorkspaceDeepLinkConsumer', () => {
  function setup() {
    const dispatch = vi.fn();
    const replaceUrl = vi.fn();
    return {
      dispatch,
      replaceUrl,
      consume: createWorkspaceDeepLinkConsumer({ dispatch, replaceUrl }),
    };
  }

  it('waits for the workspace to load before opening the note', () => {
    const { dispatch, replaceUrl, consume } = setup();
    const link = url('/workspace/ws-1?note=spec');

    expect(consume('ws-1', link, 'idle')).toBe(false);
    expect(consume('ws-1', link, 'loading')).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();

    expect(consume('ws-1', link, 'ready')).toBe(true);
    expect(dispatch).toHaveBeenCalledExactlyOnceWith(openWorkspaceNote('ws-1', 'spec'));
    expect(replaceUrl).toHaveBeenCalledExactlyOnceWith('/workspace/ws-1');
  });

  it('opens an agent chat from cached workspace state', () => {
    const { dispatch, consume } = setup();
    consume('ws-1', url('/workspace/ws-1?agent=agent-7'), 'cached-ready');
    expect(dispatch).toHaveBeenCalledExactlyOnceWith(
      openAgentTabRequested('ws-1', { agentId: 'agent-7' }),
    );
  });

  it('opens each URL once even when the load state changes again', () => {
    const { dispatch, consume } = setup();
    const link = url('/workspace/ws-1?agent=agent-7');
    consume('ws-1', link, 'cached-ready');
    consume('ws-1', link, 'ready');
    expect(dispatch).toHaveBeenCalledTimes(1);

    consume('ws-1', url('/workspace/ws-1?agent=agent-8'), 'ready');
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it('opens the same link again after the route has left it', () => {
    const { dispatch, consume } = setup();
    const link = url('/workspace/ws-a?note=spec');
    consume('ws-a', link, 'ready');
    consume('ws-a', url('/workspace/ws-a'), 'ready');
    consume('ws-b', url('/workspace/ws-b'), 'ready');
    consume('ws-a', link, 'ready');
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it('ignores URLs without deep-link parameters and failed loads', () => {
    const { dispatch, replaceUrl, consume } = setup();
    expect(consume('ws-1', url('/workspace/ws-1'), 'ready')).toBe(false);
    expect(consume('ws-1', undefined, 'ready')).toBe(false);
    expect(consume('ws-1', url('/workspace/ws-1?note=spec'), 'not-found')).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
    expect(replaceUrl).not.toHaveBeenCalled();
  });

  it('strips unusable deep-link parameters without dispatching', () => {
    const { dispatch, replaceUrl, consume } = setup();
    expect(consume('ws-1', url('/workspace/ws-1?note='), 'ready')).toBe(true);
    expect(dispatch).not.toHaveBeenCalled();
    expect(replaceUrl).toHaveBeenCalledExactlyOnceWith('/workspace/ws-1');
  });
});
