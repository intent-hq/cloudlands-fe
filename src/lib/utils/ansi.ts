/**
 * Parse terminal output that carries ANSI escape sequences into styled text
 * segments. SGR color and text attributes become segment styles; every other
 * escape (cursor moves, line erases, OSC titles and hyperlinks, charset
 * selection) is dropped. A bare carriage return followed by more text replaces
 * the whole current line, so single-line progress bars show their final
 * state; partial overwrites and cursor-up redraws are not emulated.
 */

/** A palette index (0-255) or a truecolor `#rrggbb` value. */
export type AnsiColor = number | `#${string}`;

interface AnsiStyle {
  fg?: AnsiColor;
  bg?: AnsiColor;
  bold?: true;
  dim?: true;
  italic?: true;
  underline?: true;
  inverse?: true;
}

export interface AnsiSegment extends AnsiStyle {
  text: string;
}

const ESC = '\x1b';
const BEL = '\x07';
const STYLE_KEYS = ['fg', 'bg', 'bold', 'dim', 'italic', 'underline', 'inverse'] as const;

const sameStyle = (a: AnsiStyle, b: AnsiStyle) => STYLE_KEYS.every((key) => a[key] === b[key]);

const clampByte = (value: number) => Math.min(255, Math.max(0, value));
const hexByte = (value: number) => clampByte(value).toString(16).padStart(2, '0');

function applySgr(params: string, current: AnsiStyle): AnsiStyle {
  const style: AnsiStyle = { ...current };
  const codes = params === '' ? [0] : params.split(';').map((p) => (p === '' ? 0 : Number(p)));
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];
    if (code === 0) {
      for (const key of STYLE_KEYS) delete style[key];
    } else if (code === 1) style.bold = true;
    else if (code === 2) style.dim = true;
    else if (code === 3) style.italic = true;
    else if (code === 4) style.underline = true;
    else if (code === 7) style.inverse = true;
    else if (code === 22) {
      delete style.bold;
      delete style.dim;
    } else if (code === 23) delete style.italic;
    else if (code === 24) delete style.underline;
    else if (code === 27) delete style.inverse;
    else if (code >= 30 && code <= 37) style.fg = code - 30;
    else if (code === 39) delete style.fg;
    else if (code >= 40 && code <= 47) style.bg = code - 40;
    else if (code === 49) delete style.bg;
    else if (code >= 90 && code <= 97) style.fg = code - 90 + 8;
    else if (code >= 100 && code <= 107) style.bg = code - 100 + 8;
    else if (code === 38 || code === 48) {
      const key = code === 38 ? 'fg' : 'bg';
      if (codes[i + 1] === 5) {
        const index = codes[i + 2];
        if (Number.isInteger(index) && index >= 0 && index <= 255) style[key] = index;
        i += 2;
      } else if (codes[i + 1] === 2) {
        const [r, g, b] = codes.slice(i + 2, i + 5);
        if ([r, g, b].every(Number.isFinite))
          style[key] = `#${hexByte(r)}${hexByte(g)}${hexByte(b)}`;
        i += 4;
      } else {
        i = codes.length;
      }
    }
  }
  return style;
}

/**
 * Index just past the ST/BEL terminator of a string sequence. An unterminated
 * sequence (binary output, a cut-off hyperlink) ends at the next newline so
 * later lines stay visible.
 */
function stringSequenceEnd(input: string, from: number): number {
  for (let j = from; j < input.length; j++) {
    if (input[j] === BEL) return j + 1;
    if (input[j] === ESC && input[j + 1] === '\\') return j + 2;
    if (input[j] === '\n') return j;
  }
  return input.length;
}

export function parseAnsi(input: string): AnsiSegment[] {
  const segments: AnsiSegment[] = [];
  let style: AnsiStyle = {};
  let pendingCarriageReturn = false;

  const eraseCurrentLine = () => {
    while (segments.length > 0) {
      const last = segments[segments.length - 1];
      const newline = last.text.lastIndexOf('\n');
      if (newline >= 0) {
        last.text = last.text.slice(0, newline + 1);
        return;
      }
      segments.pop();
    }
  };

  const emit = (text: string) => {
    if (text === '') return;
    if (pendingCarriageReturn) {
      pendingCarriageReturn = false;
      if (text[0] !== '\n') eraseCurrentLine();
    }
    const last = segments[segments.length - 1];
    if (last && sameStyle(last, style)) last.text += text;
    else segments.push({ text, ...style });
  };

  let textStart = 0;
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (ch === '\r') {
      emit(input.slice(textStart, i));
      if (input[i + 1] !== '\n') pendingCarriageReturn = true;
      textStart = i = i + 1;
      continue;
    }
    if (ch === BEL) {
      emit(input.slice(textStart, i));
      textStart = i = i + 1;
      continue;
    }
    if (ch !== ESC) {
      i++;
      continue;
    }

    emit(input.slice(textStart, i));
    const kind = input[i + 1];
    let end: number;
    if (kind === '[') {
      let j = i + 2;
      while (j < input.length && input.charCodeAt(j) >= 0x20 && input.charCodeAt(j) <= 0x3f) j++;
      if (j >= input.length) break;
      const final = input.charCodeAt(j);
      const params = input.slice(i + 2, j);
      // Colon sub-parameters (`38:2::r:g:b`, `4:3`) are rare; they fall through unstyled.
      if (input[j] === 'm' && /^[\d;]*$/.test(params)) style = applySgr(params, style);
      end = final >= 0x40 && final <= 0x7e ? j + 1 : j;
    } else if (kind === ']' || kind === 'P' || kind === 'X' || kind === '^' || kind === '_') {
      end = stringSequenceEnd(input, i + 2);
    } else if (kind === '(' || kind === ')' || kind === '*' || kind === '+') {
      end = i + 3;
    } else if (kind === undefined) {
      break;
    } else {
      end = i + 2;
    }
    textStart = i = Math.min(end, input.length);
  }
  if (i >= input.length) emit(input.slice(textStart));

  return segments.filter((segment) => segment.text !== '');
}

export function stripAnsi(input: string): string {
  return parseAnsi(input)
    .map((segment) => segment.text)
    .join('');
}

/** Whether the text holds anything `parseAnsi` would change. */
export function hasAnsi(input: string): boolean {
  return input.includes(ESC) || input.includes('\r') || input.includes(BEL);
}

const CUBE_STEPS = [0, 95, 135, 175, 215, 255];

/** xterm hex value for a 256-color index from the 6x6x6 cube or grayscale ramp (16-255). */
export function ansi256ToHex(index: number): `#${string}` {
  if (index >= 232) {
    const level = 8 + (index - 232) * 10;
    return `#${hexByte(level).repeat(3)}`;
  }
  const cube = index - 16;
  const r = CUBE_STEPS[Math.floor(cube / 36) % 6];
  const g = CUBE_STEPS[Math.floor(cube / 6) % 6];
  const b = CUBE_STEPS[cube % 6];
  return `#${hexByte(r)}${hexByte(g)}${hexByte(b)}`;
}
