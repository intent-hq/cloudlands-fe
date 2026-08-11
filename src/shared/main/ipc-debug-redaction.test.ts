import { describe, expect, it } from 'vitest';
import { redactIpcDebugData } from './ipc-debug-redaction';

describe('IPC debug payload redaction', () => {
  it('redacts entire payloads for sensitive channels', () => {
    expect(redactIpcDebugData('agent:send-message', { content: 'private prompt' })).toBe(
      '[redacted payload for agent:send-message]',
    );
  });

  it('redacts sensitive fields while retaining diagnostic metadata', () => {
    expect(
      redactIpcDebugData('workspace:update', {
        workspaceId: 'ws-1',
        path: '/private/repository',
        nested: { token: 'secret', count: 2 },
      }),
    ).toEqual({
      workspaceId: 'ws-1',
      path: '[redacted]',
      nested: { token: '[redacted]', count: 2 },
    });
  });
});
