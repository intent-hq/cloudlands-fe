import { describe, expect, it } from 'vitest';
import { scriptOutputTailText, scriptOutputToLines } from './script-output-text';
import type { ScriptOutputBuffer } from '$store/renderer/slices/scripts/scripts-types';

function buffer(...texts: string[]): ScriptOutputBuffer {
  return {
    chunks: texts.map((text, i) => ({
      text,
      timestamp: `2026-01-01T00:00:${String(i).padStart(2, '0')}.000Z`,
    })),
    dropped: 0,
  };
}

describe('scriptOutputToLines', () => {
  it('returns [] for an empty buffer', () => {
    expect(scriptOutputToLines(buffer())).toEqual([]);
  });

  it('joins chunks by concatenation, healing lines split across chunk boundaries', () => {
    expect(scriptOutputToLines(buffer('Compi', 'ling...\r\ndo', 'ne\r\n'))).toEqual([
      'Compiling...',
      'done',
    ]);
  });

  it('drops the trailing empty line but keeps a trailing partial line', () => {
    expect(scriptOutputToLines(buffer('a\nb'))).toEqual(['a', 'b']);
    expect(scriptOutputToLines(buffer('a\nb\n'))).toEqual(['a', 'b']);
  });

  it('treats bare \\r as line overwrite, keeping only the final spinner frame', () => {
    expect(scriptOutputToLines(buffer('⠋ building\r⠙ building\r⠹ done\r\n'))).toEqual(['⠹ done']);
  });

  it('keeps the final frame when the stream ends in a bare \\r (in-flight spinner)', () => {
    expect(scriptOutputToLines(buffer('⠋ building\r⠙ building\r'))).toEqual(['⠙ building']);
    expect(scriptOutputToLines(buffer('⠹ building\r'))).toEqual(['⠹ building']);
  });

  it('strips ANSI escape sequences, including ones split across chunks', () => {
    expect(scriptOutputToLines(buffer('\x1b[3', '2mok\x1b[0m\n'))).toEqual(['ok']);
    expect(scriptOutputToLines(buffer('\x1b]0;title\x07hi\n'))).toEqual(['hi']);
  });

  it('strips an unterminated trailing escape sequence (tail chunk not yet arrived)', () => {
    expect(scriptOutputToLines(buffer('ok\x1b[3'))).toEqual(['ok']);
    expect(scriptOutputToLines(buffer('ok\x1b['))).toEqual(['ok']);
    expect(scriptOutputToLines(buffer('ok\x1b'))).toEqual(['ok']);
    expect(scriptOutputToLines(buffer('ok\x1b]0;tit'))).toEqual(['ok']);
  });
});

describe('scriptOutputTailText', () => {
  it('returns the last N lines joined with \\n', () => {
    expect(scriptOutputTailText(buffer('a\nb\nc\nd\n'), 2)).toBe('c\nd');
  });
});
