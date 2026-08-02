import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const scriptPath = join(repoRoot, 'scripts/check-i18n-completeness.mjs');

const SETTINGS = (locales: string[]) => JSON.stringify({ baseLocale: 'en', locales });

function withFixture(files: Record<string, string>, run: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'i18n-completeness-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, name)), { recursive: true });
      writeFileSync(join(dir, name), content);
    }
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runCheck(dir: string) {
  try {
    const stdout = execFileSync(process.execPath, [scriptPath, dir], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { exitCode: 0, output: stdout };
  } catch (error) {
    const err = error as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      exitCode: err.status ?? 1,
      output: `${err.stdout?.toString() ?? ''}${err.stderr?.toString() ?? ''}`,
    };
  }
}

describe('i18n catalog completeness gate', () => {
  it('passes when every catalog matches the base key set exactly', () => {
    withFixture(
      {
        'project.inlang/settings.json': SETTINGS(['en', 'zh-CN']),
        'messages/en.json': JSON.stringify({
          $schema: 'https://inlang.com/schema/inlang-message-format',
          a_label: 'Hello {name}',
          b_count_one: '{count} item',
          b_count_many: '{count} items',
        }),
        'messages/zh-CN.json': JSON.stringify({
          a_label: '你好 {name}',
          b_count_one: '{count} 个',
          b_count_many: '{count} 个',
        }),
      },
      (dir) => {
        const result = runCheck(dir);
        expect(result.output).toContain('passed');
        expect(result.exitCode).toBe(0);
      },
    );
  });

  it('fails on a key missing from a locale catalog', () => {
    withFixture(
      {
        'project.inlang/settings.json': SETTINGS(['en', 'zh-CN']),
        'messages/en.json': JSON.stringify({ a_label: 'Hello', b_label: 'Bye' }),
        'messages/zh-CN.json': JSON.stringify({ a_label: '你好' }),
      },
      (dir) => {
        const result = runCheck(dir);
        expect(result.exitCode).toBe(1);
        expect(result.output).toContain('zh-CN: 1 missing key(s)');
        expect(result.output).toContain('- b_label');
      },
    );
  });

  it('fails on an extra key not present in the base catalog', () => {
    withFixture(
      {
        'project.inlang/settings.json': SETTINGS(['en', 'zh-CN']),
        'messages/en.json': JSON.stringify({ a_label: 'Hello' }),
        'messages/zh-CN.json': JSON.stringify({ a_label: '你好', stale_label: '旧' }),
      },
      (dir) => {
        const result = runCheck(dir);
        expect(result.exitCode).toBe(1);
        expect(result.output).toContain('zh-CN: 1 extra key(s)');
        expect(result.output).toContain('+ stale_label');
      },
    );
  });

  it('fails when placeholders differ from the base message', () => {
    withFixture(
      {
        'project.inlang/settings.json': SETTINGS(['en', 'zh-CN']),
        'messages/en.json': JSON.stringify({ a_label: 'Hello {name}' }),
        'messages/zh-CN.json': JSON.stringify({ a_label: '你好 {nom}' }),
      },
      (dir) => {
        const result = runCheck(dir);
        expect(result.exitCode).toBe(1);
        expect(result.output).toContain('zh-CN: 1 placeholder mismatch(es)');
        expect(result.output).toContain('a_label');
      },
    );
  });

  it('fails on unpaired _one/_many plural keys, including in the base catalog', () => {
    withFixture(
      {
        'project.inlang/settings.json': SETTINGS(['en']),
        'messages/en.json': JSON.stringify({ x_count_one: '{count} item' }),
      },
      (dir) => {
        const result = runCheck(dir);
        expect(result.exitCode).toBe(1);
        expect(result.output).toContain('en: 1 unpaired plural(s)');
        expect(result.output).toContain('x_count_one has no x_count_many twin');
      },
    );
  });

  it('fails when a registered locale has no catalog file, and vice versa', () => {
    withFixture(
      {
        'project.inlang/settings.json': SETTINGS(['en', 'zh-CN']),
        'messages/en.json': JSON.stringify({ a_label: 'Hello' }),
        'messages/de.json': JSON.stringify({ a_label: 'Hallo' }),
      },
      (dir) => {
        const result = runCheck(dir);
        expect(result.exitCode).toBe(1);
        expect(result.output).toContain('zh-CN: registered in project.inlang/settings.json');
        expect(result.output).toContain('de: messages/de.json exists but is not registered');
      },
    );
  });

  it('passes against the real repository catalogs', () => {
    const result = runCheck(repoRoot);
    expect(result.output).toContain('passed');
    expect(result.exitCode).toBe(0);
  });
});
