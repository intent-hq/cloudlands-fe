import { describe, it, expect, vi } from 'vitest';
import { createRepositorySelectionTransport } from './repository-selection-transport';
import type { RepositorySelectionSession } from '$shared/types/repository-selection';
const root = { kind: 'primary' as const, workspaceId: 'ws' };
function session(): RepositorySelectionSession {
  return {
    preview: {
      root,
      scope: { daemonId: 'A', authorityScopeId: 'op', authorityGeneration: '1' },
      snapshot: {
        root,
        rootIncarnation: '1',
        selectionRevision: '0',
        selection: { kind: 'neverSaved' },
      },
      expiresAfterMs: 300000,
    },
    onRetired: vi.fn(() => vi.fn()),
    confirm: vi.fn(),
    reconcile: vi.fn(),
    release: vi.fn(async () => {}),
  };
}
describe('selection facade original session', () => {
  it('captures only the original root and never sends the renderer ownership descriptor', async () => {
    const s = session(),
      capture = vi.fn(async () => s),
      handler = vi.fn();
    const opened = await createRepositorySelectionTransport(capture).begin(
      { root, editId: 'view', admission: 'guest-read' },
      handler,
    );
    expect(capture).toHaveBeenCalledWith(root);
    expect(s.onRetired).toHaveBeenCalledWith(handler);
    await opened.release();
    await opened.release();
    expect(s.release).toHaveBeenCalledOnce();
  });
  it('refuses a returned root outside the original query and releases it', async () => {
    const s = session();
    s.preview.root = { ...root, workspaceId: 'other' };
    await expect(
      createRepositorySelectionTransport(async () => s).begin(
        { root, editId: 'view', admission: 'A' },
        vi.fn(),
      ),
    ).rejects.toThrow();
    expect(s.release).toHaveBeenCalledOnce();
  });
  it('propagates unavailable instead of using an ordinary request or a new capture', async () => {
    const capture = vi.fn(async () => {
      throw new Error('forbidden');
    });
    await expect(
      createRepositorySelectionTransport(capture).begin(
        { root, editId: 'view', admission: 'A' },
        vi.fn(),
      ),
    ).rejects.toThrow('forbidden');
    expect(capture).toHaveBeenCalledOnce();
  });
});
