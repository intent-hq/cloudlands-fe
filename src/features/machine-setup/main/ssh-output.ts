/**
 * Installer output handling for the SSH setup runner (main).
 *
 * The remote output is split into lines (chunks may end mid-line, and
 * mid-character), every line is checked for the pairing link, and only a
 * redacted copy ever reaches the renderer: no link marker, QR code, `URL:`,
 * `Token:` or `Fingerprint:` line, and no `intent://` link anywhere.
 */

import { StringDecoder } from 'string_decoder';

/** Longest line forwarded to the renderer; the rest is cut. */
const MAX_LOG_LINE = 500;
const HIDDEN_LINK = 'intent://… (hidden)';

// i18n-ignore (wire constants: installer marker and `intentd pair` labels)
const MARKER_PREFIX = 'INTENT_LINK=';
const SECRET_LINE = /^\s*(?:URL|Token|Fingerprint):/;
const QR_LINE = /^[▀-▟ ]*[▀-▟][▀-▟ ]*$/;
const LINK = /intent:\/\/\S+/g;
const MARKER_LINE = /^INTENT_LINK=(intent:\/\/\S+)\s*$/;
const URL_LINE = /^\s*URL:\s*(intent:\/\/\S+)/;

/** Splits a byte stream into lines, keeping a partial line until it ends. */
export interface LineSplitter {
  /** Complete lines in this chunk (without `\n` / `\r`). */
  push(chunk: Buffer | string): string[];
  /** The trailing partial line, if any. */
  flush(): string[];
}

export function createLineSplitter(): LineSplitter {
  const decoder = new StringDecoder('utf8');
  let pending = '';
  const split = (text: string): string[] => {
    pending += text;
    const parts = pending.split('\n');
    pending = parts.pop() ?? '';
    return parts.map((line) => line.replace(/\r$/, '').replace(/^[\s\S]*\r/, ''));
  };
  return {
    push: (chunk) => split(typeof chunk === 'string' ? chunk : decoder.write(chunk)),
    flush() {
      const rest = split(decoder.end());
      const tail = pending.replace(/^[\s\S]*\r/, '');
      pending = '';
      return tail ? [...rest, tail] : rest;
    },
  };
}

/** The redacted line for the log, or null when the whole line is dropped. */
export function redactLine(line: string): string | null {
  if (line.startsWith(MARKER_PREFIX) || line.includes(MARKER_PREFIX)) return null;
  if (SECRET_LINE.test(line) || QR_LINE.test(line)) return null;
  const redacted = line.replace(LINK, HIDDEN_LINK);
  return redacted.length > MAX_LOG_LINE ? `${redacted.slice(0, MAX_LOG_LINE)}…` : redacted;
}

/** A streaming redactor: chunks in, safe complete lines out. @internal */
export interface OutputRedactor {
  push(chunk: Buffer | string): string[];
  flush(): string[];
}

/** @internal */
export function createOutputRedactor(): OutputRedactor {
  const splitter = createLineSplitter();
  const redact = (lines: string[]) =>
    lines.map(redactLine).filter((line): line is string => line !== null);
  return {
    push: (chunk) => redact(splitter.push(chunk)),
    flush: () => redact(splitter.flush()),
  };
}

/** The link on an `INTENT_LINK=<uri>` marker line (installer link marker). */
export function parseLinkMarker(line: string): string | null {
  return MARKER_LINE.exec(line.trim())?.[1] ?? null;
}

/** The link on a `URL:   <uri>` line of `intentd pair` / `intentd pair --node`. */
export function parsePairUrl(line: string): string | null {
  return URL_LINE.exec(line)?.[1] ?? null;
}

/** The first marker link in `text`, else the first `URL:` link, else null. @internal */
export function findLink(text: string): string | null {
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const link = parseLinkMarker(line);
    if (link) return link;
  }
  for (const line of lines) {
    const link = parsePairUrl(line);
    if (link) return link;
  }
  return null;
}
