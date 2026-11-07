import { describe, expect, it } from 'vitest';
import { ansi256ToHex, parseAnsi, stripAnsi } from './ansi';

const E = '\x1b';

describe('parseAnsi', () => {
  it('returns one unstyled segment for plain text', () => {
    expect(parseAnsi('hello\nworld')).toEqual([{ text: 'hello\nworld' }]);
  });

  it('returns no segments for empty input', () => {
    expect(parseAnsi('')).toEqual([]);
  });

  it('maps standard, bright and background colors to palette indexes', () => {
    expect(parseAnsi(`${E}[31mred${E}[92mgreen${E}[44mon blue${E}[103mon yellow`)).toEqual([
      { text: 'red', fg: 1 },
      { text: 'green', fg: 10 },
      { text: 'on blue', fg: 10, bg: 4 },
      { text: 'on yellow', fg: 10, bg: 11 },
    ]);
  });

  it('applies combined parameters and attribute resets', () => {
    expect(parseAnsi(`${E}[1;3;4;32mall${E}[22mno bold${E}[23;24mplain${E}[39mdefault`)).toEqual([
      { text: 'all', fg: 2, bold: true, italic: true, underline: true },
      { text: 'no bold', fg: 2, italic: true, underline: true },
      { text: 'plain', fg: 2 },
      { text: 'default' },
    ]);
  });

  it('resets everything on 0 and on an empty parameter list', () => {
    expect(parseAnsi(`${E}[1;31ma${E}[0mb${E}[2;44mc${E}[md`)).toEqual([
      { text: 'a', fg: 1, bold: true },
      { text: 'b' },
      { text: 'c', bg: 4, dim: true },
      { text: 'd' },
    ]);
  });

  it('clears the background on 49', () => {
    expect(parseAnsi(`${E}[41;37mx${E}[49my`)).toEqual([
      { text: 'x', fg: 7, bg: 1 },
      { text: 'y', fg: 7 },
    ]);
  });

  it('supports 256-color and truecolor foregrounds and backgrounds', () => {
    expect(parseAnsi(`${E}[38;5;208mo${E}[48;2;16;32;255mt`)).toEqual([
      { text: 'o', fg: 208 },
      { text: 't', fg: 208, bg: '#1020ff' },
    ]);
  });

  it('clamps truecolor channels and ignores invalid palette indexes', () => {
    expect(parseAnsi(`${E}[38;2;300;0;12mx${E}[38;5;999my`)).toEqual([
      { text: 'xy', fg: '#ff000c' },
    ]);
  });

  it('ignores unknown SGR codes without losing state', () => {
    expect(parseAnsi(`${E}[32;5;7mx`)).toEqual([{ text: 'x', fg: 2 }]);
  });

  it('drops non-SGR control sequences', () => {
    expect(parseAnsi(`${E}[?25l${E}[?2026hA${E}[2KB${E}[1GC${E}[?2026l`)).toEqual([
      { text: 'ABC' },
    ]);
  });

  it('drops OSC sequences terminated by BEL or ST, keeping hyperlink text', () => {
    expect(parseAnsi(`${E}]0;title\x07${E}]8;;https://x.dev\x07link${E}]8;;${E}\\ end`)).toEqual([
      { text: 'link end' },
    ]);
  });

  it('drops charset selection and other two-byte escapes', () => {
    expect(parseAnsi(`${E}[32mok${E}(B${E}[m done${E}=`)).toEqual([
      { text: 'ok', fg: 2 },
      { text: ' done' },
    ]);
  });

  it('drops an unterminated escape at the end of the text', () => {
    expect(parseAnsi(`tail${E}[38;5`)).toEqual([{ text: 'tail' }]);
    expect(parseAnsi(`tail${E}]8;;https://x`)).toEqual([{ text: 'tail' }]);
    expect(parseAnsi(`tail${E}`)).toEqual([{ text: 'tail' }]);
  });

  it('normalizes CRLF to LF', () => {
    expect(parseAnsi('a\r\nb\r\n')).toEqual([{ text: 'a\nb\n' }]);
  });

  it('lets a bare carriage return overwrite the current line, keeping the style', () => {
    expect(parseAnsi(`done 1\n${E}[33m10%\r50%\r${E}[1m100%${E}[0m\nnext`)).toEqual([
      { text: 'done 1\n' },
      { text: '100%', fg: 3, bold: true },
      { text: '\nnext' },
    ]);
  });

  it('keeps a line when a carriage return is not followed by more text on it', () => {
    expect(parseAnsi(`a\r${E}[0m\nb\r`)).toEqual([{ text: 'a\nb' }]);
  });

  it('merges adjacent segments with the same style', () => {
    expect(parseAnsi(`${E}[31ma${E}[31mb${E}[0m${E}[0mc`)).toEqual([
      { text: 'ab', fg: 1 },
      { text: 'c' },
    ]);
  });
});

describe('stripAnsi', () => {
  it('returns the visible text only', () => {
    expect(
      stripAnsi(`${E}[1m${E}[92m   Compiling${E}[0m gimli\r\n${E}]8;;u\x07x${E}]8;;\x07`),
    ).toBe('   Compiling gimli\nx');
  });

  it('returns plain text unchanged', () => {
    expect(stripAnsi('plain\ttext')).toBe('plain\ttext');
  });
});

describe('ansi256ToHex', () => {
  it('maps the color cube and the grayscale ramp', () => {
    expect(ansi256ToHex(16)).toBe('#000000');
    expect(ansi256ToHex(196)).toBe('#ff0000');
    expect(ansi256ToHex(208)).toBe('#ff8700');
    expect(ansi256ToHex(231)).toBe('#ffffff');
    expect(ansi256ToHex(232)).toBe('#080808');
    expect(ansi256ToHex(255)).toBe('#eeeeee');
  });
});
