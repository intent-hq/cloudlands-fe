import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkProtocolPin } from './check-intentd-protocol-pin.mjs';
import {
  OUTPUT_FILE,
  main,
  parseRustProtocolVersion,
  parseVersionModule,
  renderVersionModule,
} from './sync-intentd-protocol-version.mjs';

const PIN_FILE_CONTENT = (pin: string) => `# Exact intentd version bundled as the sidecar.\n${pin}\n`;
const RUST_SOURCE = (version: string) =>
  `/// Wire protocol.\npub const PROTOCOL_VERSION: &str = "${version}";\npub const OTHER: &str = "1.0";\n`;

const dirs: string[] = [];
function tree(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'intentd-protocol-pin-'));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const fakeFetch = (body: string, status = 200) =>
  vi.fn(async (_url: string) => new Response(body, { status }));

describe('parseRustProtocolVersion', () => {
  it('reads the PROTOCOL_VERSION constant', () => {
    expect(parseRustProtocolVersion(RUST_SOURCE('16.2'))).toBe('16.2');
  });

  it('rejects a source without exactly one constant', () => {
    expect(() => parseRustProtocolVersion('pub const OTHER: &str = "1.0";')).toThrow(/found 0/);
    expect(() => parseRustProtocolVersion(RUST_SOURCE('15.0') + RUST_SOURCE('16.0'))).toThrow(/found 2/);
  });
});

describe('generated module', () => {
  it('round-trips pin and version', () => {
    expect(parseVersionModule(renderVersionModule({ pin: '0.12.0-beta.1', version: '16.0' }))).toEqual({
      pin: '0.12.0-beta.1',
      version: '16.0',
    });
  });

  it('treats hand-written content as malformed', () => {
    expect(parseVersionModule("export const CURRENT_PROTOCOL_VERSION = '15.0';\n")).toBeNull();
  });
});

describe('sync main', () => {
  it('writes the protocol version of the pinned tag', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const dir = tree({ 'intentd.version': PIN_FILE_CONTENT('0.11.7') });
    const fetchImpl = fakeFetch(RUST_SOURCE('15.0'));
    expect(await main([], dir, { fetchImpl })).toBe(0);
    expect(fetchImpl.mock.calls[0][0]).toContain('ref=v0.11.7');
    expect(parseVersionModule(readFileSync(join(dir, OUTPUT_FILE), 'utf8'))).toEqual({
      pin: '0.11.7',
      version: '15.0',
    });
  });

  it('--check fails when the pinned tag moved to a new protocol', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const dir = tree({
      'intentd.version': PIN_FILE_CONTENT('0.11.7'),
      [OUTPUT_FILE]: renderVersionModule({ pin: '0.11.7', version: '14.0' }),
    });
    expect(await main(['--check'], dir, { fetchImpl: fakeFetch(RUST_SOURCE('15.0')) })).toBe(1);
  });

  it('--check passes when the module is current', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const dir = tree({
      'intentd.version': PIN_FILE_CONTENT('0.11.7'),
      [OUTPUT_FILE]: renderVersionModule({ pin: '0.11.7', version: '15.0' }),
    });
    expect(await main(['--check'], dir, { fetchImpl: fakeFetch(RUST_SOURCE('15.0')) })).toBe(0);
  });

  it('fails without writing when the tag cannot be fetched', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const dir = tree({ 'intentd.version': PIN_FILE_CONTENT('0.11.7') });
    expect(await main([], dir, { fetchImpl: fakeFetch('not found', 404) })).toBe(1);
    expect(() => readFileSync(join(dir, OUTPUT_FILE))).toThrow();
  });
});

describe('checkProtocolPin (offline lint)', () => {
  it('passes when the recorded pin matches intentd.version', () => {
    const dir = tree({
      'intentd.version': PIN_FILE_CONTENT('0.11.7'),
      [OUTPUT_FILE]: renderVersionModule({ pin: '0.11.7', version: '15.0' }),
    });
    expect(checkProtocolPin(dir).ok).toBe(true);
  });

  it('fails when intentd.version was edited without regenerating', () => {
    const dir = tree({
      'intentd.version': PIN_FILE_CONTENT('0.12.0'),
      [OUTPUT_FILE]: renderVersionModule({ pin: '0.11.7', version: '15.0' }),
    });
    const result = checkProtocolPin(dir);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('sync-intentd-protocol-version.mjs');
  });

  it('fails when the module is missing or hand-edited', () => {
    expect(checkProtocolPin(tree({ 'intentd.version': PIN_FILE_CONTENT('0.11.7') })).ok).toBe(false);
    const handEdited = tree({
      'intentd.version': PIN_FILE_CONTENT('0.11.7'),
      [OUTPUT_FILE]: "export const CURRENT_PROTOCOL_VERSION = '15.0';\n",
    });
    expect(checkProtocolPin(handEdited).ok).toBe(false);
  });

  it('passes on the committed tree', () => {
    expect(checkProtocolPin(process.cwd())).toMatchObject({ ok: true });
  });
});
