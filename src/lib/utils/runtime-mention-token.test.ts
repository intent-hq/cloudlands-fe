import { describe, expect, it } from 'vitest';
import { mentionTokensToText } from '$lib/services/mentions/registry';
import {
  parseRuntimeMention,
  runtimeMentionChipAttrs,
  serializeRuntimeMention,
} from './runtime-mention-token';

describe('runtime mention tokens', () => {
  it('round-trips a terminal name with spaces', () => {
    const token = serializeRuntimeMention({ kind: 'terminal', id: 'pty-0', name: 'Build server' });
    expect(token).toBe('@terminal[pty-0:Build server]');
    expect(parseRuntimeMention(token!)).toEqual({
      kind: 'terminal',
      id: 'pty-0',
      name: 'Build server',
    });
  });

  it('round-trips a script with a UUID id', () => {
    const id = '0b6f1d2e-9a4c-4f3e-8d2b-1c5e7a9f0b3d';
    const token = serializeRuntimeMention({ kind: 'script', id, name: 'Dev server' });
    expect(parseRuntimeMention(token!)).toEqual({ kind: 'script', id, name: 'Dev server' });
  });

  it('strips delimiter and markdown characters from the name', () => {
    expect(
      serializeRuntimeMention({ kind: 'terminal', id: 't1', name: 'a [b] | *c* @d http://x' }),
    ).toBe('@terminal[t1:a b c d http x]');
  });

  it('drops the ; of HTML character references so no reader decodes them', () => {
    expect(
      serializeRuntimeMention({ kind: 'terminal', id: 't1', name: 'a &#93; b &#x5B; &amp; R&D' }),
    ).toBe('@terminal[t1:a &#93 b &#x5B &amp R&D]');
  });

  it('keeps disarming when dropping one ; completes another reference', () => {
    expect(serializeRuntimeMention({ kind: 'script', id: 's1', name: 'x &ab;c; y' })).toBe(
      '@script[s1:x &abc y]',
    );
  });

  it('falls back to the id when the name is empty after sanitizing', () => {
    expect(serializeRuntimeMention({ kind: 'script', id: 's1', name: '[]' })).toBe(
      '@script[s1:s1]',
    );
  });

  it('refuses an id that is not token-safe', () => {
    expect(serializeRuntimeMention({ kind: 'terminal', id: 'a b', name: 'x' })).toBeNull();
    expect(serializeRuntimeMention({ kind: 'terminal', id: 'a:b', name: 'x' })).toBeNull();
  });

  it('rejects malformed and legacy tokens', () => {
    expect(parseRuntimeMention('@terminal/Build server')).toBeNull();
    expect(parseRuntimeMention('@terminal[a b:x]')).toBeNull();
    expect(parseRuntimeMention('@agent[a:x]')).toBeNull();
  });

  it('builds chip attributes', () => {
    expect(runtimeMentionChipAttrs({ kind: 'script', id: 's1', name: 'Dev server' })).toEqual({
      type: 'script',
      id: 's1',
      label: 'Dev server',
    });
  });

  it('renders previews as @<name> and leaves legacy tokens alone', () => {
    expect(
      mentionTokensToText('Run @script[s1:Dev server] in @terminal[pty-0:zsh] @terminal/old'),
    ).toBe('Run @Dev server in @zsh @terminal/old');
  });
});
