import { describe, expect, it, vi } from 'vitest';
import {
  createBackendAgentLockReader,
  parseAgentLocks,
  toLockRecord,
} from './backend-agent-lock-reader';
describe('canonical lock wire reader', () => {
  it('reads the exact workspace and rejects failed or malformed snapshots', async () => {
    const request = vi
      .fn()
      .mockResolvedValue({ lockedAgentIds: ['agent'], lockedFilePaths: ['a.txt'] });
    await expect(createBackendAgentLockReader(request)('ws')).resolves.toEqual({
      lockedAgentIds: { agent: true },
      lockedFilePaths: { 'a.txt': true },
    });
    expect(request).toHaveBeenCalledWith('file-tracking.getAgentLocks', { workspaceId: 'ws' });
    request.mockRejectedValueOnce(new Error('offline'));
    await expect(createBackendAgentLockReader(request)('ws')).rejects.toThrow('offline');
    for (const value of [null, {}, { lockedAgentIds: [], lockedFilePaths: ['a', 42] }])
      expect(() => parseAgentLocks(value)).toThrow();
  });
  it('preserves source tolerant normalization and treats special path keys as data', () => {
    expect(parseAgentLocks({ lockedAgentIds: ['a', 42], lockedFilePaths: null }, false)).toEqual({
      lockedAgentIds: { a: true },
      lockedFilePaths: {},
    });
    const record = toLockRecord(['__proto__', 'constructor']);
    expect(Object.keys(record)).toEqual(['__proto__', 'constructor']);
    expect(Object.getPrototypeOf(record)).toBe(Object.prototype);
  });
});
