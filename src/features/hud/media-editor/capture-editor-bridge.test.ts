import { expect, it, vi } from 'vitest';
import { defaultDockMediaEdit } from '$shared/dock-media-edit';
const ipc = vi.hoisted(() => ({
  invoke: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => null),
  on: vi.fn(),
  off: vi.fn(),
}));
vi.mock('$lib/electron-bridge', () => ({ isElectron: () => true, electronAPI: () => ipc }));
import { connectDockCaptureEditor } from './capture-editor-bridge';

it('a retired editor bridge cannot submit a late Save or request another Retake', async () => {
  const bridge = connectDockCaptureEditor(() => {});
  bridge.dispose();
  ipc.invoke.mockClear();
  const source = {
    id: 'source',
    revision: 0,
    kind: 'screenshot' as const,
    attachmentId: 'file',
    path: '.intent/attachments/file.png',
    width: 100,
    height: 100,
    durationMs: 0,
    audio: 'none' as const,
    visuals: 'clean' as const,
    batches: [],
  };
  expect(await bridge.save('retired-open', defaultDockMediaEdit(source, [], null))).toBeNull();
  expect(await bridge.retake('retired-open')).toBeNull();
  expect(ipc.invoke).not.toHaveBeenCalled();
});

it('active Save and Retake preserve their payloads and successful return values', async () => {
  const bridge = connectDockCaptureEditor(() => {});
  ipc.invoke.mockClear();
  const source = {
    id: 'active-source',
    revision: 0,
    kind: 'screenshot' as const,
    attachmentId: 'active-file',
    path: '.intent/attachments/active.png',
    width: 100,
    height: 100,
    durationMs: 0,
    audio: 'none' as const,
    visuals: 'clean' as const,
    batches: [],
  };
  const edit = defaultDockMediaEdit(source, [], null);
  const saved = { requestId: 'saved-request', result: 'saved', saved: { ...edit, revision: 1 } };
  ipc.invoke.mockResolvedValueOnce(saved);
  expect(await bridge.save('active-open', edit)).toBe(saved);
  expect(ipc.invoke).toHaveBeenLastCalledWith('dock-capture-editor:save', {
    openId: 'active-open',
    edit,
  });
  const retaken = { ok: true, candidateToken: 'candidate', source, mediaUrl: 'synthetic-media' };
  ipc.invoke.mockResolvedValueOnce(retaken);
  expect(await bridge.retake('active-open')).toBe(retaken);
  expect(ipc.invoke).toHaveBeenLastCalledWith('dock-capture-editor:retake', {
    openId: 'active-open',
  });
  bridge.dispose();
});
