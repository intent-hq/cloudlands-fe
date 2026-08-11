import { describe, expect, it } from 'vitest';
import { describeBackendUrl } from './backend-log-descriptor';

describe('describeBackendUrl', () => {
  it('retains scheme, host, port, and path while stripping sensitive URL parts', () => {
    const description = describeBackendUrl(
      'wss://user:password@backend.example:5181/ws/events?token=query-token&secret=value#fragment',
    );

    expect(description).toBe('wss://backend.example:5181/ws/events');
    expect(description).not.toMatch(/user|password|query-token|secret|value|fragment/);
  });

  it('fails closed for malformed or unsupported URLs', () => {
    expect(describeBackendUrl('not-a-url?token=secret')).toBe('[invalid-url]');
    expect(describeBackendUrl('file:///private/secret')).toBe('[invalid-url]');
    expect(describeBackendUrl(undefined)).toBe('[invalid-url]');
  });
});
