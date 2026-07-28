/**
 * Lossy plain-text projection of a script's raw-chunk output buffer.
 *
 * The scripts slice stores the PTY byte stream verbatim (see
 * `ScriptOutputBuffer`); xterm is the faithful renderer. Consumers that need
 * readable text (agent prompts, context references) derive it here at
 * consumption time instead of re-line-ifying the stored stream.
 */

import type { ScriptOutputBuffer } from '$store/renderer/slices/scripts/scripts-types';

// CSI / OSC / single-char ANSI escape sequences.
// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;

// Unterminated escape sequence at the very end of the buffer (its tail chunk
// has not arrived yet) — strip so raw bytes like `\x1b[3` don't leak through.
// eslint-disable-next-line no-control-regex
const TRAILING_PARTIAL_ANSI = /\x1b(\[[0-9;?]*[ -/]*|\][^\x07\x1b]*)?$/;

/**
 * Reconstruct the stream (plain concatenation — no separators), strip ANSI
 * escape sequences, and split into lines. A bare `\r` inside a line is
 * treated as a line-overwrite (spinner redraw): only the final segment is
 * kept. A *trailing* bare `\r` is just a cursor return — the frame before it
 * is still visible, so it is preserved. A trailing empty line from a stream
 * that ends on a newline is dropped.
 */
export function scriptOutputToLines(buffer: ScriptOutputBuffer): string[] {
  let text = '';
  for (const chunk of buffer.chunks) text += chunk.text;
  if (text === '') return [];
  // Trailing-partial strip runs first: ANSI_PATTERN's single-char alternative
  // would otherwise eat the `\x1b]` of an unterminated OSC and leak its body.
  text = text.replace(TRAILING_PARTIAL_ANSI, '').replace(ANSI_PATTERN, '');
  const endsWithNewline = /\r?\n$/.test(text);
  if (!endsWithNewline) text = text.replace(/\r$/, '');
  const lines = text.split(/\r?\n/).map((line) => {
    const cr = line.lastIndexOf('\r');
    return cr === -1 ? line : line.slice(cr + 1);
  });
  if (endsWithNewline && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Last `maxLines` readable lines of a script's output, joined with `\n`. */
export function scriptOutputTailText(buffer: ScriptOutputBuffer, maxLines: number): string {
  return scriptOutputToLines(buffer).slice(-maxLines).join('\n');
}
