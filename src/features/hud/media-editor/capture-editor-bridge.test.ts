import { expect, it, vi } from 'vitest';
import { defaultDockMediaEdit } from '$shared/dock-media-edit';
const ipc = vi.hoisted(() => ({ invoke: vi.fn(async () => null), on: vi.fn(), off: vi.fn() }));
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
