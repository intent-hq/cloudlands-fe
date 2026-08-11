import { describe, expect, it } from 'vitest';
import { redactIpcDebugData } from './ipc-debug-redaction';

describe('IPC debug payload redaction', () => {
  it('redacts entire payloads for sensitive channels', () => {
    expect(redactIpcDebugData('agent:send-message', { content: 'private prompt' })).toBe(
      '[redacted payload for agent:send-message]',
    );
  });

  it('summarizes non-sensitive channels without retaining any payload values', () => {
    const secret = 'unknown-field-secret';
    const summary = redactIpcDebugData('workspace:update', {
      workspaceId: 'ws-1',
      path: '/private/repository',
      innocentLookingField: secret,
      nested: { token: 'nested-secret', count: 2 },
    });

    expect(summary).toEqual({ type: 'object', keyCount: 4 });
    expect(JSON.stringify(summary)).not.toContain(secret);
    expect(JSON.stringify(summary)).not.toContain('nested-secret');
  });

  it('retains only collection size or primitive type metadata', () => {
    expect(redactIpcDebugData('workspace:list', ['secret-a', 'secret-b'])).toEqual({
      type: 'array',
      length: 2,
    });
    expect(redactIpcDebugData('workspace:get', 'secret')).toEqual({ type: 'string' });
  });
});
