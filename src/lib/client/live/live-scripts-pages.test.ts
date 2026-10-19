import { beforeEach, describe, expect, it, vi } from 'vitest';
import { backendRequest } from './backend-transport';
import { LiveScriptsClient } from './live-scripts-client';
import { CURRENT_PROTOCOL_VERSION } from '../../../test/current-protocol-version';

vi.mock('./backend-transport', () => ({ backendRequest: vi.fn() }));
const hello = {
  server: { protocolVersion: CURRENT_PROTOCOL_VERSION, capabilities: { scriptActiveLists: 1 } },
};
beforeEach(() => vi.resetAllMocks());
describe('active script discovery', () => {
  it('reads one bounded page and leaves the next cursor to the caller', async () => {
    vi.mocked(backendRequest)
      .mockResolvedValueOnce(hello)
      .mockResolvedValueOnce({ view: 'summary', scripts: [], nextCursor: 'next' });
    const result = await new LiveScriptsClient().listPage('ws');
    expect(result.nextCursor).toBe('next');
    expect(backendRequest).toHaveBeenLastCalledWith('script.list', {
      workspaceId: 'ws',
      archive: 'active',
      view: 'summary',
      limit: 100,
    });
    expect(backendRequest).toHaveBeenCalledTimes(2);
  });
  it('does not fall back when an old daemon lacks active lists', async () => {
    vi.mocked(backendRequest).mockResolvedValue({
      server: { protocolVersion: '13.10', capabilities: { scriptLifecycle: 1 } }, // fixture-protocol-version: old daemon before active lists
    });
    await expect(new LiveScriptsClient().listPage('ws')).rejects.toThrow();
    expect(backendRequest).toHaveBeenCalledTimes(1);
  });
  it.each(['14.0', '15.0', '16.2.1'])(
    'loads active lists from protocol %s when the capability is advertised',
    async (protocolVersion) => {
      vi.mocked(backendRequest)
        .mockResolvedValueOnce({
          server: { protocolVersion, capabilities: { scriptActiveLists: 1 } },
        })
        .mockResolvedValueOnce({ view: 'summary', scripts: [] });
      await expect(new LiveScriptsClient().listPage('ws')).resolves.toMatchObject({
        view: 'summary',
      });
    },
  );
  it.each([undefined, 0, 2])(
    'rejects a current-protocol daemon whose scriptActiveLists is %s',
    async (scriptActiveLists) => {
      vi.mocked(backendRequest).mockResolvedValue({
        server: { protocolVersion: CURRENT_PROTOCOL_VERSION, capabilities: { scriptActiveLists } },
      });
      await expect(new LiveScriptsClient().listPage('ws')).rejects.toThrow();
      expect(backendRequest).toHaveBeenCalledTimes(1);
    },
  );
  it('rejects a missing summary discriminator without a full-list retry', async () => {
    vi.mocked(backendRequest).mockResolvedValueOnce(hello).mockResolvedValueOnce({ scripts: [] });
    await expect(new LiveScriptsClient().listPage('ws')).rejects.toThrow();
    expect(backendRequest).toHaveBeenCalledTimes(2);
  });
  it('gets only the selected complete definition', async () => {
    vi.mocked(backendRequest)
      .mockResolvedValueOnce(hello)
      .mockResolvedValueOnce({
        id: 'selected',
        command: 'complete command',
        env: { KEY: 'value' },
      });
    const result = await new LiveScriptsClient().get('ws', 'selected');
    expect(result.command).toBe('complete command');
    expect(backendRequest).toHaveBeenLastCalledWith('script.get', {
      workspaceId: 'ws',
      scriptId: 'selected',
    });
  });
});
