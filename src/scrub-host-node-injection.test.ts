import { describe, expect, it } from 'vitest';
import { scrubHostNodeInjection } from './scrub-host-node-injection';

describe('scrubHostNodeInjection', () => {
  it('removes NODE_OPTIONS and every DD_-prefixed key, returning their names', () => {
    const env: NodeJS.ProcessEnv = {
      NODE_OPTIONS: '--require /opt/datadog/dd-trace/init',
      DD_INJECTION_ENABLED: 'tracer',
      DD_TAGS: 'a:b',
      DD_: '',
    };

    const removed = scrubHostNodeInjection(env);

    expect(removed.sort()).toEqual(['DD_', 'DD_INJECTION_ENABLED', 'DD_TAGS', 'NODE_OPTIONS']);
    expect(env).toEqual({});
  });

  it('leaves unrelated keys untouched, including names merely containing DD_', () => {
    const env: NodeJS.ProcessEnv = {
      PATH: '/usr/bin',
      HOME: '/home/user',
      CI: 'true',
      ADD_FOO: 'bar',
      NODE_ENV: 'test',
      NODE_OPTIONS: '--trace-deprecation',
      DD_ENV: 'prod',
    };

    const removed = scrubHostNodeInjection(env);

    expect(removed.sort()).toEqual(['DD_ENV', 'NODE_OPTIONS']);
    expect(env).toEqual({
      PATH: '/usr/bin',
      HOME: '/home/user',
      CI: 'true',
      ADD_FOO: 'bar',
      NODE_ENV: 'test',
    });
  });

  it('is a no-op on a clean env', () => {
    const env: NodeJS.ProcessEnv = { PATH: '/usr/bin', HOME: '/home/user', CI: 'true' };

    expect(scrubHostNodeInjection(env)).toEqual([]);
    expect(env).toEqual({ PATH: '/usr/bin', HOME: '/home/user', CI: 'true' });
  });

  it('is a no-op on an empty env', () => {
    const env: NodeJS.ProcessEnv = {};

    expect(scrubHostNodeInjection(env)).toEqual([]);
    expect(env).toEqual({});
  });
});
