// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { parseIntentWebOptions } from './intent-web-options';

const environment = {
  platform: 'linux' as NodeJS.Platform,
  home: '/home/example',
  env: {},
};

describe('standalone web CLI options', () => {
  it('defaults to serving on loopback with a private state directory', () => {
    expect(parseIntentWebOptions([], environment)).toMatchObject({
      command: 'serve',
      port: 47120,
      dataDir: '/home/example/.local/state/intent-web',
      local: true,
      reset: false,
    });
  });

  it('lets flags override environment configuration', () => {
    expect(
      parseIntentWebOptions(
        [
          'serve',
          '--port',
          '47121',
          '--data-dir',
          '/srv/web',
          '--tailcat',
          '/opt/tailcat',
          '--no-local',
        ],
        {
          ...environment,
          env: {
            INTENT_WEB_PORT: '47122',
            INTENT_WEB_DATA_DIR: '/state',
            TAILCAT_BIN: '/bin/tailcat',
          },
        },
      ),
    ).toMatchObject({ port: 47121, dataDir: '/srv/web', tailcat: '/opt/tailcat', local: false });
  });

  it('uses the XDG state directory and environment tailcat override', () => {
    expect(
      parseIntentWebOptions([], {
        ...environment,
        env: { XDG_STATE_HOME: '/state', TAILCAT_BIN: '/bin/tailcat' },
      }),
    ).toMatchObject({ dataDir: '/state/intent-web', tailcat: '/bin/tailcat' });
  });

  it('supports displaying and resetting the access key', () => {
    expect(parseIntentWebOptions(['key', '--reset'], environment)).toMatchObject({
      command: 'key',
      reset: true,
    });
  });

  it.each(['0', '-1', '65536', '1.5', 'abc', ''])('rejects invalid port %j', (port) => {
    expect(() => parseIntentWebOptions(['--port', port], environment)).toThrow();
  });

  it.each([
    ['--host', '0.0.0.0'],
    ['--allow-hosts', '127.0.0.1'],
    ['--unknown'],
    ['--port'],
    ['serve', '--reset'],
    ['--socket', '/tmp/web.sock', '--port', '47120'],
    ['--no-local', '--local-socket', '/tmp/intentd.sock'],
  ])('rejects unsupported or conflicting options %j', (...args) => {
    expect(() => parseIntentWebOptions(args, environment)).toThrow();
  });

  it('rejects unix listeners on Windows', () => {
    expect(() =>
      parseIntentWebOptions(['--socket', 'web.sock'], {
        ...environment,
        platform: 'win32',
        env: { LOCALAPPDATA: 'C:\\Users\\example\\AppData\\Local' },
      }),
    ).toThrow(/Windows/);
  });

  it('parses link with its lifetime and public address', () => {
    expect(parseIntentWebOptions(['link'], environment)).toMatchObject({
      command: 'link',
      ttlMinutes: 5,
      publicUrl: undefined,
    });
    expect(
      parseIntentWebOptions(
        ['link', '--ttl', '15', '--url', 'https://box.tailnet.ts.net:8443/'],
        environment,
      ),
    ).toMatchObject({ ttlMinutes: 15, publicUrl: 'https://box.tailnet.ts.net:8443' });
    expect(
      parseIntentWebOptions(['link'], {
        ...environment,
        env: { INTENT_WEB_PUBLIC_URL: 'https://box.example' },
      }),
    ).toMatchObject({ publicUrl: 'https://box.example' });
  });

  it('rejects bad link options', () => {
    for (const ttl of ['0', '16', '2.5', 'x'])
      expect(() => parseIntentWebOptions(['link', '--ttl', ttl], environment)).toThrow('--ttl');
    for (const url of ['ftp://box', 'https://box/path', 'https://u:p@box', 'not a url'])
      expect(() => parseIntentWebOptions(['link', '--url', url], environment)).toThrow('--url');
    expect(() => parseIntentWebOptions(['serve', '--ttl', '5'], environment)).toThrow(
      'require link',
    );
    expect(() => parseIntentWebOptions(['key', '--url', 'https://box'], environment)).toThrow(
      'require link',
    );
  });
});
