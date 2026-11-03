import { createCollection } from '@themislib/themis/utils/collections/collection-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withLegacyPrincipal } from '../../../test/fixtures/principal-state';

const mocks = vi.hoisted(() => ({ output: vi.fn() }));
vi.mock('$lib/client', () => ({ appClient: { scripts: { output: mocks.output } } }));

import {
  appendScriptOutput,
  scriptsReducer,
  setScriptsData,
} from '$store/renderer/slices/scripts/scripts-slice';
import { createDefaultRuntimeState } from '$features/scripts/types';
import type { StoreState } from '$store/renderer/types';
import { readScriptContextOutputLines } from './script-context-output';

const WS = 'ws-1';
const ID = 'script-1';

function stateWith(chunks: string[] = []): StoreState {
  let scripts = scriptsReducer(undefined, { type: '@@init' });
  scripts = scriptsReducer(
    scripts,
    setScriptsData(WS, [
      {
        id: ID,
        workspaceId: WS,
        name: 'Dev server',
        command: 'pnpm dev',
        mode: 'service',
        source: 'user',
        purpose: 'saved',
        createdAt: '2026-01-01T00:00:00.000Z',
        runtime: createDefaultRuntimeState(),
      },
    ] as never),
  );
  for (const text of chunks) {
    scripts = scriptsReducer(scripts, appendScriptOutput(WS, ID, { text, timestamp: '' }));
  }
  return withLegacyPrincipal({
    tabState: { currentTabId: WS },
    workspace: { workspaces: createCollection('id', [{ id: WS, myRole: 'owner' }]) },
    scripts,
  }) as unknown as StoreState;
}

describe('readScriptContextOutputLines', () => {
  beforeEach(() => {
    mocks.output.mockReset();
  });

  it('prefers the live buffer when a viewer streamed output', async () => {
    const lines = await readScriptContextOutputLines(stateWith(['one\ntwo\n', 'three\n']), WS, ID);

    expect(lines).toEqual(['one', 'two', 'three']);
    expect(mocks.output).not.toHaveBeenCalled();
  });

  it('falls back to the daemon output when nothing streamed live', async () => {
    mocks.output.mockResolvedValue('a\nb\nc\n');

    const lines = await readScriptContextOutputLines(stateWith(), WS, ID, 2);

    expect(mocks.output).toHaveBeenCalledWith(WS, ID, 2);
    expect(lines).toEqual(['b', 'c']);
  });

  it.each([
    ['the no-output sentinel', () => mocks.output.mockResolvedValue('No output yet.')],
    ['an empty reply', () => mocks.output.mockResolvedValue('')],
    ['a failed read', () => mocks.output.mockRejectedValue(new Error('gone'))],
  ])('returns no lines for %s', async (_name, arrange) => {
    arrange();
    await expect(readScriptContextOutputLines(stateWith(), WS, ID)).resolves.toEqual([]);
  });

  it('does not read the daemon without a workspace', async () => {
    await expect(readScriptContextOutputLines(stateWith(), null, ID)).resolves.toEqual([]);
    expect(mocks.output).not.toHaveBeenCalled();
  });
});
