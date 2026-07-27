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

/**
 * Reconstruct the stream (plain concatenation — no separators), strip ANSI
 * escape sequences, and split into lines. A bare `\r` is treated as a
 * line-overwrite (spinner redraw): only the final segment of each line is
 * kept. A trailing empty line from a stream that ends on a newline is
 * dropped.
 */
export function scriptOutputToLines(buffer: ScriptOutputBuffer): string[] {
  let text = '';
  for (const chunk of buffer.chunks) text += chunk.text;
  if (text === '') return [];
  text = text.replace(ANSI_PATTERN, '');
  const lines = text.split(/\r?\n/).map((line) => {
    const cr = line.lastIndexOf('\r');
    return cr === -1 ? line : line.slice(cr + 1);
  });
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Last `maxLines` readable lines of a script's output, joined with `\n`. */
export function scriptOutputTailText(buffer: ScriptOutputBuffer, maxLines: number): string {
  return scriptOutputToLines(buffer).slice(-maxLines).join('\n');
}
