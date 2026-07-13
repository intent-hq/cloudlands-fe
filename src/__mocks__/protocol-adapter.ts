/**
 * Mock protocol adapter for tests
 * This prevents vitest from trying to resolve the complex dependency chain of the real protocol-adapter
 */

import { vi } from 'vitest';

export const protocolAdapter = {
  listWorkspaces: vi.fn().mockResolvedValue({ ok: true, data: [] }),
  createNote: vi.fn().mockResolvedValue({ ok: true, data: { id: 'test-note-id', title: 'Test Note' } }),
  markAsTask: vi.fn().mockResolvedValue({ ok: true, data: {} }),
  assignAgentToTask: vi.fn().mockResolvedValue({ ok: true, data: {} }),
  getWorkspaceInfo: vi.fn().mockResolvedValue({ ok: true, data: null }),
  listFiles: vi.fn().mockResolvedValue({ ok: true, data: [] }),
};

export class ProtocolAdapter {
  listWorkspaces = protocolAdapter.listWorkspaces;
  createNote = protocolAdapter.createNote;
  markAsTask = protocolAdapter.markAsTask;
  assignAgentToTask = protocolAdapter.assignAgentToTask;
  getWorkspaceInfo = protocolAdapter.getWorkspaceInfo;
  listFiles = protocolAdapter.listFiles;
}
