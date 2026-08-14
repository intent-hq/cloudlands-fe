/**
 * Tests for the pure loopback-hostname rewrite helper
 * (intent-hq/monorepo#2323). Covers every row of the rewrite table in both
 * local and remote daemon setups, plus the degrade-gracefully paths (missing
 * daemonHost, unparseable URLs, non-http schemes).
 */

import { describe, expect, it } from 'vitest';

import {
  classifyLoopbackHost,
  loopbackContextFromTransport,
  rewriteLoopbackUrl,
  type LoopbackRewriteContext,
} from '../main/loopback-rewrite';

const LOCAL: LoopbackRewriteContext = { daemonIsRemote: false };
const REMOTE: LoopbackRewriteContext = { daemonIsRemote: true, daemonHost: '10.0.0.5' };
const REMOTE_NO_HOST: LoopbackRewriteContext = { daemonIsRemote: true };

describe('classifyLoopbackHost', () => {
  it('classifies the reserved aliases', () => {
    expect(classifyLoopbackHost('daemon.localhost')).toBe('daemon-alias');
    expect(classifyLoopbackHost('client.localhost')).toBe('client-alias');
    expect(classifyLoopbackHost('DAEMON.LOCALHOST')).toBe('daemon-alias');
  });

  it('classifies bare loopback forms, bracketed or not', () => {
    expect(classifyLoopbackHost('127.0.0.1')).toBe('bare-loopback');
    expect(classifyLoopbackHost('localhost')).toBe('bare-loopback');
    expect(classifyLoopbackHost('[::1]')).toBe('bare-loopback');
    expect(classifyLoopbackHost('::1')).toBe('bare-loopback');
  });

  it('leaves everything else as other, including unreserved *.localhost', () => {
    expect(classifyLoopbackHost('example.com')).toBe('other');
    expect(classifyLoopbackHost('foo.localhost')).toBe('other');
    expect(classifyLoopbackHost('10.0.0.5')).toBe('other');
  });
});

describe('rewriteLoopbackUrl — local (same-host) setup', () => {
  it('rewrites daemon.localhost to 127.0.0.1', () => {
    const result = rewriteLoopbackUrl('http://daemon.localhost:3000/app?x=1#top', LOCAL);
    expect(result.url).toBe('http://127.0.0.1:3000/app?x=1#top');
    expect(result.rewritten).toBe(true);
    expect(result.requestedUrl).toBe('http://daemon.localhost:3000/app?x=1#top');
    expect(result.reason).toContain('daemon is local');
    expect(result.warning).toBeUndefined();
  });

  it('rewrites client.localhost to 127.0.0.1', () => {
    const result = rewriteLoopbackUrl('https://client.localhost:8443/path', LOCAL);
    expect(result.url).toBe('https://127.0.0.1:8443/path');
    expect(result.rewritten).toBe(true);
  });

  it('leaves bare loopback unchanged', () => {
    for (const url of ['http://127.0.0.1:3000/', 'http://localhost:3000/', 'http://[::1]:3000/']) {
      expect(rewriteLoopbackUrl(url, LOCAL)).toEqual({ url, rewritten: false });
    }
  });
});

describe('rewriteLoopbackUrl — remote daemon setup', () => {
  it('rewrites daemon.localhost to the daemon host, preserving everything else', () => {
    const result = rewriteLoopbackUrl('https://daemon.localhost:8443/a/b?q=1&r=2#frag', REMOTE);
    expect(result.url).toBe('https://10.0.0.5:8443/a/b?q=1&r=2#frag');
    expect(result.rewritten).toBe(true);
    expect(result.requestedUrl).toBe('https://daemon.localhost:8443/a/b?q=1&r=2#frag');
    expect(result.reason).toContain('10.0.0.5');
    expect(result.warning).toBeUndefined();
  });

  it('rewrites client.localhost to 127.0.0.1', () => {
    const result = rewriteLoopbackUrl('http://client.localhost:5173/', REMOTE);
    expect(result.url).toBe('http://127.0.0.1:5173/');
    expect(result.rewritten).toBe(true);
    expect(result.warning).toBeUndefined();
  });

  it('rewrites bare loopback to the daemon host with an ambiguity warning', () => {
    for (const [url, expected] of [
      ['http://127.0.0.1:3000/x', 'http://10.0.0.5:3000/x'],
      ['http://localhost:3000/x', 'http://10.0.0.5:3000/x'],
      ['http://[::1]:3000/x', 'http://10.0.0.5:3000/x'],
    ] as const) {
      const result = rewriteLoopbackUrl(url, REMOTE);
      expect(result.url).toBe(expected);
      expect(result.rewritten).toBe(true);
      expect(result.requestedUrl).toBe(url);
      expect(result.warning).toContain('daemon.localhost');
      expect(result.warning).toContain('client.localhost');
    }
  });

  it('brackets an IPv6 daemon host when assigning it', () => {
    const result = rewriteLoopbackUrl('http://daemon.localhost:3000/', {
      daemonIsRemote: true,
      daemonHost: 'fd00::2',
    });
    expect(result.url).toBe('http://[fd00::2]:3000/');
    expect(result.rewritten).toBe(true);
  });

  it('degrades to a non-rewritten result with a reason when daemonHost is missing', () => {
    for (const url of ['http://daemon.localhost:3000/', 'http://127.0.0.1:3000/']) {
      const result = rewriteLoopbackUrl(url, REMOTE_NO_HOST);
      expect(result.url).toBe(url);
      expect(result.rewritten).toBe(false);
      expect(result.reason).toContain('host is unknown');
    }
  });
});

describe('rewriteLoopbackUrl — no-op paths', () => {
  it('leaves non-loopback hosts unchanged in both modes', () => {
    const url = 'https://example.com:8443/path?q=1';
    expect(rewriteLoopbackUrl(url, LOCAL)).toEqual({ url, rewritten: false });
    expect(rewriteLoopbackUrl(url, REMOTE)).toEqual({ url, rewritten: false });
  });

  it('leaves unreserved *.localhost subdomains unchanged', () => {
    const url = 'http://foo.localhost:3000/';
    expect(rewriteLoopbackUrl(url, REMOTE)).toEqual({ url, rewritten: false });
  });

  it('leaves non-http(s) schemes unchanged', () => {
    for (const url of ['about:blank', 'chrome://version', 'file:///tmp/x.html']) {
      const result = rewriteLoopbackUrl(url, REMOTE);
      expect(result.url).toBe(url);
      expect(result.rewritten).toBe(false);
    }
  });

  it('never throws on unparseable URLs', () => {
    const result = rewriteLoopbackUrl('not a url', REMOTE);
    expect(result.url).toBe('not a url');
    expect(result.rewritten).toBe(false);
    expect(result.reason).toContain('not a parseable URL');
  });
});

describe('loopbackContextFromTransport', () => {
  it('resolves local when the backend is same-host or UDS', () => {
    expect(loopbackContextFromTransport(true)).toEqual({ daemonIsRemote: false });
    expect(loopbackContextFromTransport(false, { transport: 'uds' })).toEqual({
      daemonIsRemote: false,
    });
  });

  it('resolves the remote host for wss and tcp transports', () => {
    expect(loopbackContextFromTransport(false, { transport: 'wss', host: '10.0.0.5' })).toEqual({
      daemonIsRemote: true,
      daemonHost: '10.0.0.5',
    });
    expect(loopbackContextFromTransport(false, { transport: 'tcp', host: '10.0.0.5' })).toEqual({
      daemonIsRemote: true,
      daemonHost: '10.0.0.5',
    });
  });

  it('resolves the remote host from the ws URL', () => {
    expect(
      loopbackContextFromTransport(false, { transport: 'ws', wsUrl: 'ws://10.0.0.5:5181/ws' }),
    ).toEqual({ daemonIsRemote: true, daemonHost: '10.0.0.5' });
  });

  it('treats loopback ws/tcp targets as local (dev loopback WS)', () => {
    expect(
      loopbackContextFromTransport(false, { transport: 'ws', wsUrl: 'ws://127.0.0.1:5181/ws' }),
    ).toEqual({ daemonIsRemote: false });
    expect(loopbackContextFromTransport(false, { transport: 'tcp', host: 'localhost' })).toEqual({
      daemonIsRemote: false,
    });
  });

  it('degrades to remote-without-host for missing or unparseable targets', () => {
    expect(loopbackContextFromTransport(false)).toEqual({ daemonIsRemote: true });
    expect(loopbackContextFromTransport(false, { transport: 'ws', wsUrl: 'not-a-url' })).toEqual({
      daemonIsRemote: true,
    });
    expect(loopbackContextFromTransport(false, { transport: 'wss' })).toEqual({
      daemonIsRemote: true,
    });
  });
});
