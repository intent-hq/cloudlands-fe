// @verify-changed-triggers: e2e/mock-acp-request.js, e2e/mock-acp-agent.js
import { expect, it, vi } from 'vitest';
import { respondToMockRequest } from '../e2e/mock-acp-request.js';
import { createMockChild } from '../e2e/mock-workspace-mcp.js';

it('returns a missing parent bridge failure on the original prompt ID', async () => {
  const report = vi.fn();
  const response = await respondToMockRequest(
    JSON.stringify({ jsonrpc: '2.0', id: 'prompt-42', method: 'session/prompt' }),
    () => createMockChild([], { name: 'Implementor', prompt: 'CHILD_REQUEST: fixture' }),
    report,
  );
  expect(JSON.parse(response)).toEqual({
    jsonrpc: '2.0',
    id: 'prompt-42',
    error: {
      code: -32603,
      message: 'Error: Missing unique daemon-provided workspace MCP stdio bridge',
    },
  });
  expect(report).toHaveBeenCalledWith(
    '[mock-agent] session/prompt failed: Error: Missing unique daemon-provided workspace MCP stdio bridge\n',
  );
});

it('reserves a null-ID parse error for malformed JSON without running a handler', async () => {
  const handle = vi.fn();
  const report = vi.fn();
  const result = JSON.parse(await respondToMockRequest('{', handle, report));
  expect(result).toMatchObject({ jsonrpc: '2.0', id: null, error: { code: -32700 } });
  expect(handle).not.toHaveBeenCalled();
  expect(report).not.toHaveBeenCalled();
});

it('preserves successful response bytes and silent notification completion', async () => {
  const report = vi.fn();
  const result = '{"jsonrpc":"2.0","id":0,"result":{"stopReason":"end_turn"}}';
  expect(await respondToMockRequest('{"id":0}', async () => result, report)).toBe(result);
  expect(await respondToMockRequest('{"method":"session/cancel"}', () => null, report)).toBeNull();
  expect(report).not.toHaveBeenCalled();
});

it('bounds a rejected handler diagnostic and never responds to a notification', async () => {
  const report = vi.fn();
  const fail = async () => {
    throw new Error('x'.repeat(4096));
  };
  const request = JSON.parse(await respondToMockRequest('{"id":0}', fail, report));
  expect(request.id).toBe(0);
  expect(request.error.code).toBe(-32603);
  expect(request.error.message).toHaveLength(2048);
  expect(await respondToMockRequest('{"method":"session/cancel"}', fail, report)).toBeNull();
  expect(report).toHaveBeenCalledTimes(2);
});
