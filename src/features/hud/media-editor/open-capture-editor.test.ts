import { afterEach, expect, it, vi } from 'vitest';
import { runSaga } from 'redux-saga';
import type { DockCaptureEditorOpenRequest } from '$shared/dock-capture-editor';
import { openDockCaptureEditor } from './open-capture-editor';
import { beginDockEditorHold } from '$store/renderer/slices/dock-conversation/sagas/dock-editor-hold';

const ipc = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('$lib/electron-bridge', () => ({ electronAPI: () => ipc }));

const request: DockCaptureEditorOpenRequest = {
  kind: 'recording',
  workspaceId: 'workspace',
  agentId: 'agent',
  attachmentId: 'clip',
  sourceRevision: 'source:0',
  attachmentPath: '.intent/attachments/clip.mp4',
  title: 'Recording',
  durationMs: 1000,
  marks: [],
  provenance: { visuals: 'clean', hasMicAudio: true },
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

it('opens a finished recording on desktop without reading hidden preferences', async () => {
  vi.stubGlobal('window', { electronAPI: { versions: { electron: '44.10.2' } } });
  const getItem = vi.fn(() => {
    throw new Error('Storage unavailable');
  });
  vi.stubGlobal('localStorage', { getItem });
  ipc.invoke.mockResolvedValueOnce({ ok: true, openId: 'editor' });

  expect(await openDockCaptureEditor(request)).toEqual({ ok: true, openId: 'editor' });
  expect(ipc.invoke).toHaveBeenCalledWith('dock-capture-editor:open', request);
  expect(getItem).not.toHaveBeenCalled();
});

it.each([
  ['plain browser', {}],
  [
    'browser preview bridge',
    { electronAPI: { versions: { electron: '0.0.0-browser' }, invoke: ipc.invoke } },
  ],
])('does not request a native editor in a %s', async (_name, browser) => {
  vi.stubGlobal('window', browser);

  expect(await openDockCaptureEditor(request)).toEqual({ ok: false, error: 'unavailable' });
  expect(await runSaga({}, beginDockEditorHold, true).toPromise()).toBeNull();
  expect(ipc.invoke).not.toHaveBeenCalled();
});
