import { describe, expect, it } from 'vitest';
import {
  createLineSplitter,
  createOutputRedactor,
  findLink,
  parseLinkMarker,
  parsePairUrl,
  redactLine,
} from '../ssh-output';
import {
  chunked,
  installerOutput,
  NODE_SECRET,
  NODE_URI,
  PAIR_FINGERPRINT,
  PAIR_NODE_OUTPUT,
  PAIR_OUTPUT,
  PAIR_TOKEN,
  PAIR_URI,
} from './fixtures';

function redactAll(text: string, size: number): string[] {
  const redactor = createOutputRedactor();
  const lines = chunked(text, size).flatMap((chunk) => redactor.push(chunk));
  return [...lines, ...redactor.flush()];
}

function expectNoSecrets(lines: string[]) {
  const text = lines.join('\n');
  expect(text).not.toContain(PAIR_TOKEN);
  expect(text).not.toContain(NODE_SECRET);
  expect(text).not.toContain(PAIR_FINGERPRINT);
  expect(text).not.toContain('intent://pair');
  expect(text).not.toContain('intent://node');
  expect(text).not.toContain('INTENT_LINK');
  expect(text).not.toMatch(/[▀-▟]/);
}

describe('line splitter', () => {
  it('keeps partial lines and split characters across chunks', () => {
    const splitter = createLineSplitter();
    const bytes = Buffer.from('ab█\ncd\r\nef', 'utf8');
    const lines = [
      ...splitter.push(bytes.subarray(0, 3)),
      ...splitter.push(bytes.subarray(3, 6)),
      ...splitter.push(bytes.subarray(6)),
      ...splitter.flush(),
    ];
    expect(lines).toEqual(['ab█', 'cd', 'ef']);
  });

  it('keeps the last redraw of a carriage-return progress line', () => {
    const splitter = createLineSplitter();
    expect(splitter.push('10%\r50%\r100%\n')).toEqual(['100%']);
  });
});

describe('redactor', () => {
  it.each([1, 3, 7, 64, 4096])('drops every secret of `intentd pair` in %i-byte chunks', (size) => {
    const lines = redactAll(PAIR_OUTPUT, size);
    expectNoSecrets(lines);
    expect(lines).toContain('Host:        10.0.0.5');
    expect(lines).toContain('Tunnel:      k3x9.tailcat.net:443');
    expect(lines).toContain('  Scan with the Intent iOS app to pair this device automatically.');
  });

  it.each([1, 5, 33])('drops every secret of `intentd pair --node` in %i-byte chunks', (size) => {
    const lines = redactAll(PAIR_NODE_OUTPUT, size);
    expectNoSecrets(lines);
    expect(lines.some((line) => line.startsWith('This link works once'))).toBe(true);
  });

  it.each([2, 11])('drops the marker line of the installer in %i-byte chunks', (size) => {
    const lines = redactAll(installerOutput(PAIR_URI, { withPairOutput: true }), size);
    expectNoSecrets(lines);
    expect(lines).toContain(
      'install.sh: waiting for the daemon to respond (first start downloads the daemon binary)...',
    );
  });

  it('hides a link anywhere else in a line', () => {
    expect(redactLine(`  open ${NODE_URI} now`)).toBe('  open intent://… (hidden) now');
    expect(redactLine('   Token: x')).toBeNull();
    expect(redactLine('  URL: x')).toBeNull();
    expect(redactLine('   ')).toBe('   ');
  });
});

describe('link parser', () => {
  it('reads the marker line', () => {
    expect(parseLinkMarker(`INTENT_LINK=${PAIR_URI}`)).toBe(PAIR_URI);
    expect(parseLinkMarker(`INTENT_LINK=${PAIR_URI}\r`)).toBe(PAIR_URI);
    expect(parseLinkMarker('INTENT_LINK=https://evil')).toBeNull();
  });

  it('reads the URL line of `intentd pair` and `pair --node`', () => {
    expect(findLink(PAIR_OUTPUT)).toBe(PAIR_URI);
    expect(findLink(PAIR_NODE_OUTPUT)).toBe(NODE_URI);
    expect(parsePairUrl('Host:        10.0.0.5')).toBeNull();
  });

  it('prefers the marker over a URL line', () => {
    expect(findLink(installerOutput(NODE_URI, { withPairOutput: true }))).toBe(NODE_URI);
    expect(findLink('nothing here')).toBeNull();
  });
});
