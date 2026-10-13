import { afterEach, describe, expect, it, vi } from 'vitest';
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('$lib/electron-bridge', () => ({ invoke }));
vi.mock('$lib/client', () => ({ appClient: {} }));
vi.mock('$features/git/git.client', () => ({ gitClient: {} }));
vi.mock('$store/renderer/store', () => ({ store: { dispatch: vi.fn(), state: {} } }));
import { rendererEventRecovery } from '$features/events/renderer-event-recovery';
import type { Workspace } from '$shared/types';
import { prepareContext } from './context-preparation';
const workspace = { id: 'ws-review', worktreePath: '/repo' } as Workspace;
afterEach(() => {
  rendererEventRecovery.dispose();
  vi.clearAllMocks();
});
describe('review context authority', () => {
  it('retains ordinary file review context', async () => {
    invoke.mockResolvedValue({ success: true, data: { content: 'current source' } });
    const message = await prepareContext(workspace, 'review', 'result', {
      reviewFiles: ['one.ts'],
    });
    expect(message).toContain('current source');
    expect(invoke).toHaveBeenCalledTimes(1);
  });
  it('rejects a retired file reply and never starts the next file', async () => {
    let finish!: (value: unknown) => void;
    invoke.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const result = prepareContext(workspace, 'review', 'result', {
      reviewFiles: ['one.ts', 'two.ts'],
    });
    const rejected = expect(result).rejects.toThrow('authority retired');
    rendererEventRecovery.dispose();
    finish({ success: true, data: { content: 'old protected source' } });
    await rejected;
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
