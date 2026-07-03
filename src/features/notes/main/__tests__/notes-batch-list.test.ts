/**
 * AUDIT-P0-2 wire-contract test for the notes:batch-list IPC handler.
 *
 * Verifies that per-workspace failures surface as
 * `{ success: false, error: string }` entries instead of being silently
 * masked as empty notes arrays. A success for one workspace and a failure
 * for another must coexist in the same response.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture handlers registered via ipcMain.handle so the test can invoke them
// directly without spinning up a real Electron main process.
const registeredHandlers = new Map<string, (...args: any[]) => any>();
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
      registeredHandlers.set(channel, handler);
    }),
    on: vi.fn(),
  },
  BrowserWindow: { getAllWindows: () => [] },
}));

// Mock the protocol adapter — listNotes is the only seam batch-list calls.
// vi.hoisted keeps the spy in scope of the hoisted vi.mock factory.
const { listNotes } = vi.hoisted(() => ({ listNotes: vi.fn() }));
vi.mock('../../../protocol/main/protocol-adapter', () => ({
  protocolAdapter: { listNotes },
}));

// Other notes.ipc imports rely on system state — stub the open-workspace seam.
vi.mock('../../../system/main/system.ipc', () => ({
  getAllOpenWorkspaceIds: () => [],
}));

import { NOTES_CHANNELS } from '$shared/ipc/channels';
import { setupNotesIPC } from '../notes.ipc';

describe('notes:batch-list (AUDIT-P0-2 per-workspace error surface)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registeredHandlers.clear();
    setupNotesIPC();
  });

  // Workspace IDs must match the slug/UUID schema enforced by
  // NotesBatchListSchema; use a couple of valid slugs.
  const WS_A = 'amber-forest';
  const WS_B = 'amber-forest-2';

  it('returns { success:true, notes } per workspace on success', async () => {
    listNotes.mockImplementation(async (wsId: string) => [
      { id: `${wsId}-n1`, title: 'note 1' },
    ]);

    const handler = registeredHandlers.get(NOTES_CHANNELS.BATCH_LIST);
    expect(handler).toBeDefined();

    const response = await handler!({}, { workspaceIds: [WS_A, WS_B] });

    expect(response.success).toBe(true);
    expect(response.data[WS_A]).toEqual({
      success: true,
      notes: [{ id: `${WS_A}-n1`, title: 'note 1' }],
    });
    expect(response.data[WS_B]).toEqual({
      success: true,
      notes: [{ id: `${WS_B}-n1`, title: 'note 1' }],
    });
  });

  it('surfaces { success:false, error } for the failing workspace without masking it as empty notes (AUDIT-P0-2)', async () => {
    listNotes.mockImplementation(async (wsId: string) => {
      if (wsId === WS_B) throw new Error('disk fell over');
      return [{ id: `${wsId}-n1`, title: 'ok' }];
    });

    const handler = registeredHandlers.get(NOTES_CHANNELS.BATCH_LIST);
    const response = await handler!({}, { workspaceIds: [WS_A, WS_B] });

    expect(response.success).toBe(true);
    expect(response.data[WS_A]).toEqual({
      success: true,
      notes: [{ id: `${WS_A}-n1`, title: 'ok' }],
    });
    expect(response.data[WS_B]).toEqual({
      success: false,
      error: 'disk fell over',
    });
  });

  it('coerces non-array success payloads to an empty notes list (defensive, still success-shaped)', async () => {
    listNotes.mockResolvedValueOnce(null as any);

    const handler = registeredHandlers.get(NOTES_CHANNELS.BATCH_LIST);
    const response = await handler!({}, { workspaceIds: [WS_A] });

    expect(response.data[WS_A]).toEqual({ success: true, notes: [] });
  });
});
